import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fixture from '../fixtures/analyst-request-v2.json';
import { collectEvidence } from '../../server/evidence.mjs';
import { runAnalysisV3 } from '../../server/runAnalysisV3.mjs';
import { PROMPT_V2 } from '../../server/prompts/promptV2.mjs';
import { EV_ID_PATTERN } from '../../shared/analystOutputV4.mjs';

vi.mock('../../server/evidence.mjs', () => ({ collectEvidence: vi.fn() }));

const provider = { provider_type: 'custom', settings: {} };
const marketSnapshot = { ...fixture, schema_version: '2', analysis_scope: 'market', previous_analysis: null, wallet: { has_holdings: false, holdings: {}, value_intl_egp: 0, value_egypt_egp: null, cost_basis: [] }, dca: null, watchlist: [] };
const personalSnapshot = { ...fixture, schema_version: '2', previous_analysis: null };
const pack = {
  searchStatus: 'ok', usedWebSearch: true, evidenceIds: ['EV-001', 'EV-002'],
  evidenceSources: [{ id: 'EV-001', title: 'A', date: '', link: 'https://a.test' }, { id: 'EV-002', title: 'B', date: '', link: 'https://b.test' }],
  evidencePack: [{ id: 'EV-001', title: 'A', date: '', snippet: 'usd strength' }, { id: 'EV-002', title: 'B', date: '', snippet: 'cb buying' }],
};

// The v4 pipeline remaps evidence.mjs's EV-001-style ids to the EV_ID_PATTERN shape before
// sending them to the model, so a fake provider must read back whatever id landed in the prompt
// (it is timestamp-based, not fixed) rather than assume a literal string.
function idsFromPrompt(prompt) {
  // The retry loop appends "\nCORRECTION: ..." after the same base prompt, so bound the slice
  // to the compact (single-line) EVIDENCE_PACK JSON itself, not everything to end-of-string.
  const rest = prompt.slice(prompt.indexOf('EVIDENCE_PACK\n') + 'EVIDENCE_PACK\n'.length);
  const end = rest.indexOf('\n');
  return JSON.parse(end === -1 ? rest : rest.slice(0, end)).map((e) => e.id);
}
function snapshotFromPrompt(prompt) {
  const json = prompt.slice(prompt.indexOf('DATA_SNAPSHOT\n') + 'DATA_SNAPSHOT\n'.length, prompt.indexOf('\nEVIDENCE_PACK'));
  return JSON.parse(json);
}
const validOutput = (evId, over = {}) => ({
  status: 'material_change', confidence: 'medium', headline: 'USD strength offsets local premium relief.',
  data_flags: [], evidence: [{ ev_id: evId, implication: 'Stronger dollar pressures gold near-term.' }],
  scenario_weights: { deesc: 35, base: 45, stag: 20 }, weight_changes: [],
  action: 'hold', next_trigger: 'Next FOMC statement.', invalidation: 'A surprise rate cut.',
  ...over,
});
const answer = (obj, usage) => ({ text: JSON.stringify(obj), usage });

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('ANALYST_V4', '1');
  collectEvidence.mockResolvedValue(structuredClone(pack));
});
afterEach(() => vi.unstubAllEnvs());

describe('runAnalysisV3 delegates to the v4 pipeline under ANALYST_V4=1', () => {
  it('runs the standard tier end-to-end on the old evidence source and passes the validator', async () => {
    const runProvider = vi.fn(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), { input_tokens: 50, output_tokens: 30 }));

    const out = await runAnalysisV3(provider, marketSnapshot, runProvider);

    expect(out.validation).toEqual({ ok: true, errors: [] });
    expect(out.result.scenario_weights).toEqual({ deesc: 35, base: 45, stag: 20 });
    expect(runProvider).toHaveBeenCalledTimes(1);
    const [, , options] = runProvider.mock.calls[0];
    expect(options.system).toBe(PROMPT_V2);
    expect(options.compact).toBe('v4');
    expect(options.jsonSchema.schema.required).toContain('scenario_weights');
  });

  it('runs the personalized tier end-to-end and requires dca_read', async () => {
    const runProvider = vi.fn(async (_p, prompt) => {
      const evId = idsFromPrompt(prompt)[0];
      return answer(validOutput(evId, { dca_read: { text: 'Within the current tranche limit.', ev_ids: [] } }), { input_tokens: 60, output_tokens: 40 });
    });

    const out = await runAnalysisV3(provider, personalSnapshot, runProvider);

    expect(out.validation).toEqual({ ok: true, errors: [] });
    expect(out.result.dca_read.text).toBe('Within the current tranche limit.');
    const options = runProvider.mock.calls[0][2];
    expect(options.jsonSchema.schema.required).toContain('dca_read');
    expect(options.maxTokens).toBe(2550);
  });

  it('uses the standard tier max_tokens cap', async () => {
    const runProvider = vi.fn(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), { input_tokens: 1, output_tokens: 1 }));
    await runAnalysisV3(provider, marketSnapshot, runProvider);
    expect(runProvider.mock.calls[0][2].maxTokens).toBe(1400);
  });

  it('ignores an admin-supplied prompt override (v4 has no admin-editable prompt layer)', async () => {
    const runProvider = vi.fn(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), undefined));
    await runAnalysisV3(provider, marketSnapshot, runProvider, { prompts: { system: 'CUSTOM SYSTEM', format: 'CUSTOM FORMAT' } });
    expect(runProvider.mock.calls[0][2].system).toBe(PROMPT_V2);
  });

  it('remaps evidence ids to the EV-YYYYMMDD-HHMM-NN pattern the schema expects', async () => {
    const runProvider = vi.fn(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), undefined));
    const out = await runAnalysisV3(provider, marketSnapshot, runProvider);
    const [ev1, ev2] = idsFromPrompt(runProvider.mock.calls[0][1]);
    expect(EV_ID_PATTERN.test(ev1)).toBe(true);
    expect(EV_ID_PATTERN.test(ev2)).toBe(true);
    expect(out.evidenceSources.map((s) => s.id)).toEqual([ev1, ev2]);
  });

  it('adds the Phase 2 precomputes to DATA_SNAPSHOT, with no persisted pack yet', async () => {
    const runProvider = vi.fn(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), undefined));
    await runAnalysisV3(provider, marketSnapshot, runProvider);
    const snap = snapshotFromPrompt(runProvider.mock.calls[0][1]);
    expect(snap.evidence_pack_id).toBeNull();
    expect(Number.isFinite(Date.parse(snap.evidence_built_at))).toBe(true);
    expect(typeof snap.evidence_age_hours).toBe('number');
    expect(snap.evidence_age_hours).toBeGreaterThanOrEqual(0);
    expect(snap.prior_state_eligible).toBe(false);
  });

  it('marks prior_state_eligible true only when the recent prior decision matches the current weights', async () => {
    const runProvider = vi.fn(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), undefined));
    const recent = new Date(Date.parse(marketSnapshot.generated_at) - 3600_000).toISOString();
    const eligible = { ...marketSnapshot, previous_analysis: { generated_at: recent, action: 'wait', confidence: 'medium', suggested_weights: { deesc: 35, base: 45, stag: 20 } } };
    await runAnalysisV3(provider, eligible, runProvider);
    expect(snapshotFromPrompt(runProvider.mock.calls[0][1]).prior_state_eligible).toBe(true);
  });

  it('sends only the active DCA mode\'s fields, plus current_installment_limit_egp', async () => {
    const runProvider = vi.fn(async (_p, prompt) => {
      const evId = idsFromPrompt(prompt)[0];
      return answer(validOutput(evId, { dca_read: { text: 'x', ev_ids: [] } }), undefined);
    });
    await runAnalysisV3(provider, personalSnapshot, runProvider);
    const dca = snapshotFromPrompt(runProvider.mock.calls[0][1]).dca;
    expect(Object.keys(dca).sort()).toEqual(['current_installment_limit_egp', 'mode', 'total_investment_egp', 'tranche_split_pct'].sort());
    expect(dca.current_installment_limit_egp).toBe(40000);
  });

  it('records usage per attempt (not summed) and the retry count', async () => {
    const runProvider = vi.fn()
      .mockImplementationOnce(async (_p, prompt) => answer({ ...validOutput(idsFromPrompt(prompt)[0]), scenario_weights: { deesc: 35, base: 45, stag: 30 } }, { input_tokens: 40, output_tokens: 10 }))
      .mockImplementationOnce(async (_p, prompt) => answer(validOutput(idsFromPrompt(prompt)[0]), { input_tokens: 45, output_tokens: 12 }));

    const out = await runAnalysisV3(provider, marketSnapshot, runProvider);

    expect(out.validation.ok).toBe(true);
    expect(out.retries).toBe(1);
    expect(out.usage).toEqual({ input_tokens: 45, output_tokens: 12 });
    expect(out.metrics.attempts).toEqual([
      { outputTokens: 10, inputTokens: 40, truncated: false },
      { outputTokens: 12, inputTokens: 45, truncated: false },
    ]);
    expect(runProvider).toHaveBeenCalledTimes(2);
  });

  it('fails closed with a null result after two invalid answers', async () => {
    const runProvider = vi.fn().mockResolvedValue({ text: '{}', usage: { input_tokens: 5, output_tokens: 2 } });
    const out = await runAnalysisV3(provider, marketSnapshot, runProvider);
    expect(out.validation.ok).toBe(false);
    expect(out.result).toBeNull();
    expect(out.retries).toBe(1);
    expect(runProvider).toHaveBeenCalledTimes(2);
  });

  it('treats a truncated completion as a validation failure', async () => {
    const runProvider = vi.fn(async (_p, prompt) => ({ ...answer(validOutput(idsFromPrompt(prompt)[0]), { input_tokens: 5, output_tokens: 2 }), truncated: true }));
    const out = await runAnalysisV3(provider, marketSnapshot, runProvider);
    expect(out.validation.errors).toContain('completion was truncated');
  });
});
