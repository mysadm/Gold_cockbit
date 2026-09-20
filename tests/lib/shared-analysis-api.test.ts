import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  fetchLatest,
  fetchSchedule,
  saveSchedule,
  runNow,
  fetchNotifications,
  dismissNotification,
  type AnalysisSchedule,
  type LatestResponse,
  type StandardRun,
} from '../../src/api/sharedAnalysis';
import { parseCompactAnalysis } from '../../src/lib/analyst';
import { parseStandardRun, canApplyWeights } from '../../src/ui/StandardAnalysisCard';
import { validateSnapshot } from '../../shared/analystContract.mjs';
import type { AnalysisSnapshot } from '../../src/lib/analysisSnapshot';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const schedule: AnalysisSchedule = { enabled: true, times: ['09:00', '17:00'], tz: 'Africa/Cairo', language: 'ar' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(...responses: Response[]) {
  const f = vi.fn();
  for (const r of responses) f.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', f);
  return f;
}

describe('shared analysis api', () => {
  it('fetchLatest GETs /api/analysis/latest with no body or content type', async () => {
    const payload: LatestResponse = { schedule, slot: { key: '2026-09-21@09:00', next_at: '2026-09-21T14:00:00.000Z' }, latest: null, running: false };
    const f = stub(json(200, payload));
    expect(await fetchLatest()).toEqual(payload);
    expect(f).toHaveBeenCalledWith('/api/analysis/latest', { method: 'GET', headers: undefined, body: undefined });
  });

  it('fetchSchedule GETs /api/analysis/schedule', async () => {
    const f = stub(json(200, schedule));
    expect(await fetchSchedule()).toEqual(schedule);
    expect(f).toHaveBeenCalledWith('/api/analysis/schedule', expect.objectContaining({ method: 'GET', body: undefined }));
  });

  it('saveSchedule PUTs the schedule as JSON and returns the saved one', async () => {
    const f = stub(json(200, schedule));
    expect(await saveSchedule(schedule)).toEqual(schedule);
    expect(f).toHaveBeenCalledWith('/api/analysis/schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schedule),
    });
  });

  it('runNow POSTs an empty JSON object to /api/analysis/run-now', async () => {
    const f = stub(json(200, { status: 'done', id: 7 }));
    expect(await runNow()).toEqual({ status: 'done', id: 7 });
    expect(f).toHaveBeenCalledWith('/api/analysis/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  });

  it('fetchNotifications GETs the admin notifications', async () => {
    const rows = [{ id: 1, kind: 'standard_analysis_failed', message: 'x', created_at: 'a', updated_at: 'b' }];
    const f = stub(json(200, rows));
    expect(await fetchNotifications()).toEqual(rows);
    expect(f).toHaveBeenCalledWith('/api/admin/notifications', expect.objectContaining({ method: 'GET' }));
  });

  it('dismissNotification POSTs to the per-id dismiss route without a body', async () => {
    const f = stub(json(200, { ok: true }));
    expect(await dismissNotification(42)).toEqual({ ok: true });
    expect(f).toHaveBeenCalledWith('/api/admin/notifications/42/dismiss', { method: 'POST', headers: undefined, body: undefined });
  });

  it('throws the server error text from {error}', async () => {
    stub(json(400, { error: 'Unknown timezone "Mars/Base"' }));
    await expect(saveSchedule({ ...schedule, tz: 'Mars/Base' })).rejects.toThrow('Unknown timezone "Mars/Base"');
    stub(json(502, { error: 'Provider unreachable' }));
    await expect(runNow()).rejects.toThrow('Provider unreachable');
    stub(json(403, { error: 'Admin only' }));
    await expect(fetchNotifications()).rejects.toThrow('Admin only');
  });

  it('falls back to HTTP <status> when the error body is not JSON or has no error field', async () => {
    stub(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(fetchLatest()).rejects.toThrow('HTTP 502');
    stub(json(500, { detail: 'boom' }));
    await expect(fetchSchedule()).rejects.toThrow('HTTP 500');
    stub(new Response('', { status: 404 }));
    await expect(dismissNotification(9)).rejects.toThrow('HTTP 404');
  });

  it('propagates a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')));
    await expect(fetchLatest()).rejects.toThrow('offline');
  });
});

// A stored server run: market-only snapshot (empty wallet, no DCA, no watchlist)
// and a v3 result without wallet/dca/watchlist reads.
const marketOnlySnapshot = {
  schema_version: '2',
  generated_at: '2026-09-21T06:00:00.000Z',
  locale: 'en',
  explanation_level: 'beginner',
  market: { xau_usd: 4000, usd_egp: 50, weighted_target_usd: 5070, xau_retrieved_at: '2026-09-21T05:59:00.000Z', fx_retrieved_at: '2026-09-21T05:59:00.000Z' },
  price_alignment: { aligned: true, premium_reliable: true, age_gap_minutes: 1, max_gap_minutes: 60 },
  previous_analysis: null,
  scenarios: [
    { key: 'deesc', name_en: 'Geopolitical Changes', weight_pct: 35, price_lo: 5800, price_hi: 6300, thesis: 'Easing' },
    { key: 'base', name_en: 'Base Case', weight_pct: 45, price_lo: 5000, price_hi: 5400, thesis: 'Official demand' },
    { key: 'stag', name_en: 'Stagflation', weight_pct: 20, price_lo: 3600, price_hi: 4000, thesis: 'Dollar pressure' },
  ],
  egypt: { retrieved_at: '2026-09-21T05:58:00.000Z', rows: [{ karat: '24k', sell: 6500, buy: 6450 }], implied_gold_market_usd_egp: 50.54, local_premium_pct: 1.09 },
  wallet: { has_holdings: false, holdings: {}, value_intl_egp: 0, value_egypt_egp: null, cost_basis: [] },
  dca: null,
  watchlist: [],
} as unknown as AnalysisSnapshot;

const storedText = JSON.stringify({
  schema_version: '3',
  status: 'material_change',
  primary_decision: { action: 'wait', horizon: 'now', headline: 'Hold off until the Fed decision', confidence: 'medium', next_trigger: 'Fed statement', invalidation: 'A surprise cut' },
  evidence: [{ evidence_id: 'EV-001', scenario_effect: 'mixed', strength: 'medium', implication: 'Central bank buying offsets higher rates' }],
  suggested_weights: { deesc: 30, base: 50, stag: 20 },
  weight_changes: [
    { scenario: 'deesc', from: 35, to: 30, evidence_ids: ['EV-001'] },
    { scenario: 'base', from: 45, to: 50, evidence_ids: ['EV-001'] },
  ],
  reads: { egp: 'Local premium is about 1 percent' },
  assumptions: ['Rates stay flat'],
  missing_inputs: [],
});

describe('a stored standard run renders through the existing parser', () => {
  const run: StandardRun = {
    id: 1,
    slot_key: '2026-09-21@09:00',
    created_at: '2026-09-21T06:01:00.000Z',
    text: storedText,
    snapshot: marketOnlySnapshot,
    validation: { ok: true, errors: [] },
    evidence_sources: [{ id: 'EV-001', title: 'Reuters', link: 'https://example.com/a', date: '2026-09-20' }],
    used_web_search: true,
    search_status: 'ok',
    provider_label: 'Main provider',
  };

  it('the market-only snapshot passes the shared snapshot validator', () => {
    expect(validateSnapshot(marketOnlySnapshot)).toEqual([]);
  });

  it('parses with no wallet, dca or watchlist reads', () => {
    const view = parseCompactAnalysis(run.text, run.snapshot as AnalysisSnapshot, run.evidence_sources.map((s) => s.id));
    expect(view.primary_decision.action).toBe('wait');
    expect(view.primary_decision.reasons).toEqual([{ text: 'Central bank buying offsets higher rates', evidence_ids: ['EV-001'] }]);
    expect(view.suggested_weights).toEqual({ deesc: 30, base: 50, stag: 20 });
    expect(view.assumptions).toEqual(['Rates stay flat']);
    expect(view.wallet_read).toBeUndefined();
    expect(view.dca_read).toBeUndefined();
    expect(view.watchlist_read).toBeUndefined();
    expect(view.compact_result?.reads.wallet).toBeUndefined();
    expect(view.compact_result?.reads.dca).toBeUndefined();
  });

  it('rejects a run whose evidence ids are not in its sources (the card ignores such runs)', () => {
    expect(() => parseCompactAnalysis(run.text, run.snapshot as AnalysisSnapshot, [])).toThrow();
    expect(() => parseCompactAnalysis('not json', run.snapshot as AnalysisSnapshot, ['EV-001'])).toThrow();
  });

  it('the card helpers parse the run and gate Apply like the personalized button', () => {
    const view = parseStandardRun(run);
    expect(view?.primary_decision.headline).toBe('Hold off until the Fed decision');
    expect(canApplyWeights(run, view)).toBe(true);
    expect(canApplyWeights({ ...run, validation: { ok: false, errors: ['x'] } }, view)).toBe(false);
    expect(parseStandardRun({ ...run, text: 'garbage' })).toBeNull();
    expect(parseStandardRun(null)).toBeNull();
    expect(canApplyWeights(null, null)).toBe(false);
    const insufficient = JSON.stringify({
      schema_version: '3', status: 'insufficient_evidence',
      primary_decision: { action: 'insufficient_evidence', horizon: 'now', headline: 'Not enough evidence', confidence: 'low', next_trigger: 'Fresh data', invalidation: 'Data arrives' },
      evidence: [], suggested_weights: { deesc: 35, base: 45, stag: 20 }, weight_changes: [],
      reads: { egp: 'Prices are inputs' }, assumptions: [], missing_inputs: [],
    });
    const weak = { ...run, text: insufficient };
    expect(canApplyWeights(weak, parseStandardRun(weak))).toBe(false);
  });
});
