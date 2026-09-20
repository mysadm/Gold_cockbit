import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import pg from 'pg';
import { claimSlot, slotState, latestDone, runStandardAnalysis, sweepStrandedRuns } from '../../server/standardAnalysis.mjs';
import { listOpen, raiseNotification } from '../../server/adminNotifications.mjs';
import { DEFAULT_SCHEDULE } from '../../server/analysisSchedule.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
const NOW = new Date('2026-09-20T10:00:00.000Z');
const SLOT = '2026-09-20@08:00';
const KIND = 'standard_analysis_failed';
const SCHEDULE = { ...DEFAULT_SCHEDULE, enabled: true, language: 'en' };

let client, admin;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin' });
  await provisionUserDefaults(client, admin.id);
});
afterEach(async () => { await client.end(); vi.useRealTimers(); });

async function addProvider({ active = true, label = 'Test model' } = {}) {
  await client.query(
    `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'ollama', $2, 'm', $3)`,
    [admin.id, label, active]
  );
}
const row = async (slot = SLOT) => (await client.query('SELECT * FROM shared_analysis_runs WHERE slot_key = $1', [slot])).rows[0];
const age = (slot, { startedMin = 0, finishedMin = null } = {}) => client.query(
  `UPDATE shared_analysis_runs SET started_at = now() - ($2 || ' minutes')::interval,
          finished_at = CASE WHEN $3::text IS NULL THEN finished_at ELSE now() - ($3 || ' minutes')::interval END WHERE slot_key = $1`,
  [slot, String(startedMin), finishedMin === null ? null : String(finishedMin)]
);

const prices = { spot: 4500, usdEgp: 48.5, goldSource: 'gold-api', retrievedAt: NOW.toISOString() };
const egypt = { source: 'isagha.com', fetchedAt: '2026-09-20T09:58:00.000Z', rows: [{ karat: '24k', sell: 7000, buy: 6950 }] };
const parsed = {
  schema_version: '3', status: 'insufficient_evidence',
  primary_decision: { action: 'hold', horizon: 'now', confidence: 'medium', headline: 'h', next_trigger: 'n', invalidation: 'i' },
  suggested_weights: { deesc: 35, base: 45, stag: 20 }, evidence: [], weight_changes: [], reads: { egp: 'e' }, assumptions: [], missing_inputs: [],
};
const analysisOutput = (over = {}) => ({
  text: JSON.stringify(parsed), result: parsed, validation: { ok: true, errors: [] },
  usedWebSearch: true, searchStatus: 'ok', evidenceSources: [{ id: 'EV-001', title: 't', link: 'https://x.test', date: 'd' }], ...over,
});
function makeDeps(over = {}) {
  const deps = {
    fetchPrices: vi.fn(async () => prices),
    fetchEgypt: vi.fn(async () => egypt),
    runAnalysis: vi.fn(async () => analysisOutput()),
    now: () => NOW,
    notify: vi.fn(async () => {}),
    ...over,
  };
  return deps;
}
const run = (deps, slotKey = SLOT) => runStandardAnalysis({ db: client, adminId: admin.id, slotKey, schedule: SCHEDULE, deps });

describe('an invalid model answer', () => {
  it('is a failed attempt with the reason and a max-tokens hint, never a stored analysis', async () => {
    await addProvider();
    const bad = analysisOutput({ validation: { ok: false, errors: ['response must be a JSON object', 'completion was truncated'] } });
    const deps = makeDeps({ runAnalysis: vi.fn(async () => bad) });

    const out = await run(deps);

    expect(out.status).toBe('failed');
    const r = await row();
    expect(r.status).toBe('failed');
    expect(r.result).toBeNull();
    expect(r.error).toContain('completion was truncated');
    expect(r.error).toMatch(/Max tokens/i);
    const open = (await client.query('SELECT message FROM admin_notifications WHERE kind = $1 AND resolved_at IS NULL', [KIND])).rows;
    expect(open).toHaveLength(1);
    expect(open[0].message).toContain('completion was truncated');
  });

  it('keeps the previous good analysis as the latest one', async () => {
    await addProvider();
    await run(makeDeps(), '2026-09-19@16:00');
    const bad = analysisOutput({ validation: { ok: false, errors: ['completion was truncated'] } });

    await run(makeDeps({ runAnalysis: vi.fn(async () => bad) }));

    const latest = await latestDone(client);
    expect(latest.slot_key).toBe('2026-09-19@16:00');
  });
});

describe('claimSlot', () => {
  it('claims a fresh slot once and refuses an immediate second claim', async () => {
    const id = await claimSlot(client, SLOT);
    expect(typeof id).toBe('number');
    expect(await claimSlot(client, SLOT)).toBeNull();
    expect((await row()).attempts).toBe(1);
  });

  it('re-claims a failed slot only after 5 minutes, counting an attempt', async () => {
    await claimSlot(client, SLOT);
    await client.query(`UPDATE shared_analysis_runs SET status = 'failed', finished_at = now() - interval '4 minutes', error = 'x'`);
    expect(await claimSlot(client, SLOT)).toBeNull();
    await age(SLOT, { finishedMin: 6 });
    expect(await claimSlot(client, SLOT)).not.toBeNull();
    const r = await row();
    expect(r).toMatchObject({ status: 'running', attempts: 2, error: null, finished_at: null });
  });

  it('allows a 3rd attempt and refuses a 4th', async () => {
    await claimSlot(client, SLOT);
    for (const expected of [2, 3]) {
      await client.query(`UPDATE shared_analysis_runs SET status = 'failed', finished_at = now() - interval '6 minutes'`);
      expect(await claimSlot(client, SLOT)).not.toBeNull();
      expect((await row()).attempts).toBe(expected);
    }
    await client.query(`UPDATE shared_analysis_runs SET status = 'failed', finished_at = now() - interval '6 minutes'`);
    expect(await claimSlot(client, SLOT)).toBeNull();
    expect((await row()).attempts).toBe(3);
  });

  it('re-claims a stale running claim (older than 4 minutes) as a new attempt, but not a fresh one', async () => {
    await claimSlot(client, SLOT);
    await age(SLOT, { startedMin: 3 });
    expect(await claimSlot(client, SLOT)).toBeNull();
    await age(SLOT, { startedMin: 5 });
    expect(await claimSlot(client, SLOT)).not.toBeNull();
    expect((await row()).attempts).toBe(2);
  });

  it('never re-claims a done slot', async () => {
    await claimSlot(client, SLOT);
    await client.query(`UPDATE shared_analysis_runs SET status = 'done', finished_at = now() - interval '1 day', started_at = now() - interval '1 day'`);
    expect(await claimSlot(client, SLOT)).toBeNull();
  });

  // A single pg.Client serializes its queries, so these use a real pool: the claims run on
  // separate connections and Postgres (not the client) has to pick the single winner.
  describe('concurrent claims on separate connections', () => {
    let pool;
    beforeEach(() => { pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 }); });
    afterEach(async () => { await pool.end(); });

    it('two concurrent claims of a fresh slot produce exactly one id', async () => {
      const results = await Promise.all([claimSlot(pool, SLOT), claimSlot(pool, SLOT)]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await row()).attempts).toBe(1);
    });

    it('many concurrent claims of a fresh slot produce exactly one id', async () => {
      const results = await Promise.all(Array.from({ length: 8 }, () => claimSlot(pool, SLOT)));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await row()).attempts).toBe(1);
    });

    it('several concurrent claims of a re-claimable failed row produce exactly one id and one attempt', async () => {
      await claimSlot(client, SLOT);
      await client.query(`UPDATE shared_analysis_runs SET status = 'failed', finished_at = now() - interval '6 minutes', error = 'x'`);
      const results = await Promise.all(Array.from({ length: 6 }, () => claimSlot(pool, SLOT)));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await row()).toMatchObject({ status: 'running', attempts: 2 });
    });
  });
});

describe('sweepStrandedRuns', () => {
  const insert = (slot, { status = 'running', attempts = 3, startedMin = 10 } = {}) => client.query(
    `INSERT INTO shared_analysis_runs (slot_key, status, attempts, started_at, finished_at)
     VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval, CASE WHEN $2 = 'running' THEN NULL ELSE now() END)`,
    [slot, status, attempts, String(startedMin)]
  );
  const sweep = (deps = makeDeps()) => sweepStrandedRuns({ db: client, deps });

  it('fails a running attempt-3 claim older than 4 minutes, raises one notification and calls notify(final:true)', async () => {
    await insert(SLOT);
    const deps = makeDeps();
    await sweep(deps);
    expect(await row()).toMatchObject({ status: 'failed', attempts: 3, error: 'The server stopped during the last attempt' });
    expect((await row()).finished_at).not.toBeNull();
    const open = await listOpen(client);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe(KIND);
    expect(open[0].message).toContain(SLOT);
    expect(open[0].message).toContain('not retried');
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith({
      event: KIND, slot: SLOT, error: 'The server stopped during the last attempt', attempts: 3, final: true,
    });
  });

  it('leaves a running attempt-3 claim younger than 4 minutes alone', async () => {
    await insert(SLOT, { startedMin: 2 });
    const deps = makeDeps();
    await sweep(deps);
    expect(await row()).toMatchObject({ status: 'running', attempts: 3 });
    expect(await listOpen(client)).toEqual([]);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('leaves running attempt 1 and 2 claims alone (the reclaim path handles them)', async () => {
    await insert('2026-09-20@08:00', { attempts: 1 });
    await insert('2026-09-20@16:00', { attempts: 2 });
    const deps = makeDeps();
    await sweep(deps);
    const { rows } = await client.query('SELECT status FROM shared_analysis_runs');
    expect(rows.map((r) => r.status)).toEqual(['running', 'running']);
    expect(await listOpen(client)).toEqual([]);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('leaves done and failed rows alone', async () => {
    await insert('2026-09-20@08:00', { status: 'done' });
    await insert('2026-09-20@16:00', { status: 'failed' });
    const deps = makeDeps();
    await sweep(deps);
    const { rows } = await client.query('SELECT status, error FROM shared_analysis_runs ORDER BY slot_key');
    expect(rows).toEqual([{ status: 'done', error: null }, { status: 'failed', error: null }]);
    expect(await listOpen(client)).toEqual([]);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('marks a stranded adhoc row failed but raises no notification', async () => {
    await insert('adhoc:1789000000000');
    await sweep();
    expect(await row('adhoc:1789000000000')).toMatchObject({ status: 'failed', error: 'The server stopped during the last attempt' });
    expect(await listOpen(client)).toEqual([]);
  });

  it('a second sweep raises no second notification', async () => {
    await insert(SLOT);
    const deps = makeDeps();
    await sweep(deps);
    await client.query(`UPDATE admin_notifications SET message = 'edited'`);
    await sweep(deps);
    const open = await listOpen(client);
    expect(open).toHaveLength(1);
    expect(open[0].message).toBe('edited');
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('a throwing notify hook never escapes the sweep', async () => {
    await insert(SLOT);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sweep(makeDeps({ notify: async () => { throw new Error('hook down'); } }))).resolves.toBeUndefined();
    expect(await row()).toMatchObject({ status: 'failed' });
    errSpy.mockRestore();
  });
});

describe('slotState', () => {
  it('reports none, running, failed (with claimable) and done', async () => {
    expect(await slotState(client, SLOT)).toEqual({ state: 'none', attempts: 0, claimable: true });
    await claimSlot(client, SLOT);
    expect(await slotState(client, SLOT)).toEqual({ state: 'running', attempts: 1, claimable: false });
    await age(SLOT, { startedMin: 5 });
    expect((await slotState(client, SLOT)).claimable).toBe(true);
    await client.query(`UPDATE shared_analysis_runs SET status = 'failed', started_at = now(), finished_at = now()`);
    expect(await slotState(client, SLOT)).toEqual({ state: 'failed', attempts: 1, claimable: false });
    await age(SLOT, { finishedMin: 6 });
    expect((await slotState(client, SLOT)).claimable).toBe(true);
    await client.query(`UPDATE shared_analysis_runs SET attempts = 3`);
    expect((await slotState(client, SLOT)).claimable).toBe(false);
    await client.query(`UPDATE shared_analysis_runs SET status = 'done'`);
    expect(await slotState(client, SLOT)).toEqual({ state: 'done', attempts: 3, claimable: false });
  });
});

describe('runStandardAnalysis: success', () => {
  it('stores a done row with the result payload and an empty wallet/dca/watchlist snapshot', async () => {
    await addProvider({ label: 'My Ollama' });
    const deps = makeDeps();
    const out = await run(deps);
    expect(out.status).toBe('done');
    const r = await row();
    expect(r).toMatchObject({ status: 'done', attempts: 1, error: null });
    expect(Number(r.id)).toBe(out.id);
    expect(r.finished_at).not.toBeNull();
    expect(r.result).toMatchObject({
      text: JSON.stringify(parsed), parsed, validation: { ok: true, errors: [] },
      used_web_search: true, search_status: 'ok', provider_label: 'My Ollama', slot_key: SLOT,
    });
    expect(r.result.evidence_sources).toHaveLength(1);
    const snap = r.result.snapshot;
    expect(snap.wallet).toMatchObject({ has_holdings: false, holdings: {}, cost_basis: [] });
    expect(snap.dca).toBeNull();
    expect(snap.watchlist).toEqual([]);
    expect(snap.locale).toBe('en');
    expect(snap.market).toMatchObject({ xau_usd: 4500, usd_egp: 48.5 });
    expect(snap.egypt.rows[0]).toMatchObject({ karat: '24k', sell: 7000 });
    expect(snap.price_alignment).toBeTruthy();
    // the model is called with the admin's provider and an abort signal
    const [provider, snapshotArg, , opts] = deps.runAnalysis.mock.calls[0];
    expect(provider.label).toBe('My Ollama');
    expect(snapshotArg.wallet.has_holdings).toBe(false);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  it('is not charged to anyone: no ai_shared_usage rows', async () => {
    await addProvider();
    await run(makeDeps());
    expect((await client.query('SELECT count(*)::int AS n FROM ai_shared_usage')).rows[0].n).toBe(0);
  });

  it('uses the admin scenario weights as the framework and the schedule language', async () => {
    await addProvider();
    await client.query(`UPDATE scenarios SET weight_pct = CASE sort_order WHEN 0 THEN 10 WHEN 1 THEN 60 ELSE 30 END WHERE user_id = $1`, [admin.id]);
    await run(makeDeps());
    expect((await row()).result.snapshot.scenarios.map((s) => s.weight_pct)).toEqual([10, 60, 30]);
  });

  it('resolves an open failure notification', async () => {
    await addProvider();
    await raiseNotification(client, { kind: KIND, message: 'earlier failure' });
    await run(makeDeps());
    expect(await listOpen(client)).toEqual([]);
  });

  it('tolerates an Egypt price failure: still done, with egypt: null', async () => {
    await addProvider();
    const out = await run(makeDeps({ fetchEgypt: vi.fn(async () => { throw new Error('isagha down'); }) }));
    expect(out.status).toBe('done');
    expect((await row()).result.snapshot.egypt).toBeNull();
  });

  it('feeds the last valid done run back as previous_analysis (skipping insufficient_evidence and invalid runs)', async () => {
    await addProvider();
    const mk = (slot, minsAgo, action, ok) => client.query(
      `INSERT INTO shared_analysis_runs (slot_key, status, attempts, result, started_at, finished_at)
       VALUES ($1, 'done', 1, $2::jsonb, now() - ($3 || ' minutes')::interval, now() - ($3 || ' minutes')::interval)`,
      [slot, JSON.stringify({
        snapshot: { generated_at: '2026-09-19T08:00:00.000Z' }, validation: { ok, errors: [] },
        parsed: { primary_decision: { action, confidence: 'high' }, suggested_weights: { deesc: 20, base: 50, stag: 30 } },
      }), String(minsAgo)]
    );
    await mk('2026-09-19@16:00', 10, 'insufficient_evidence', true);
    await mk('2026-09-19@08:00', 20, 'buy', false);
    await mk('2026-09-18@16:00', 30, 'reduce', true);
    const deps = makeDeps();
    await run(deps);
    const snap = deps.runAnalysis.mock.calls[0][1];
    expect(snap.previous_analysis).toEqual({
      generated_at: '2026-09-19T08:00:00.000Z', action: 'reduce', confidence: 'high', suggested_weights: { deesc: 20, base: 50, stag: 30 },
    });
  });

  it('latestDone returns the newest done run flattened, or null', async () => {
    expect(await latestDone(client)).toBeNull();
    await addProvider();
    await run(makeDeps());
    const latest = await latestDone(client);
    expect(latest).toMatchObject({ slot_key: SLOT, text: JSON.stringify(parsed), provider_label: 'Test model', used_web_search: true, search_status: 'ok' });
    expect(typeof latest.id).toBe('number');
    expect(Number.isFinite(Date.parse(latest.created_at))).toBe(true);
    expect(Object.keys(latest).sort()).toEqual(
      ['created_at', 'evidence_sources', 'id', 'provider_label', 'search_status', 'slot_key', 'snapshot', 'text', 'used_web_search', 'validation']
    );
  });
});

describe('runStandardAnalysis: terminal write symmetry', () => {
  it('a failing resolveNotifications after a successful run still reports done', async () => {
    await addProvider();
    // Make the best-effort notification cleanup fail for real: the relation is gone.
    await client.query('DROP TABLE admin_notifications');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await run(makeDeps());
    expect(out.status).toBe('done');
    expect(await row()).toMatchObject({ status: 'done', attempts: 1, error: null });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('a done write that finds the row no longer running is a supersession: skipped, row untouched', async () => {
    await addProvider();
    const deps = makeDeps({
      runAnalysis: async () => {
        await client.query(`UPDATE shared_analysis_runs SET status = 'failed', error = 'reaped', finished_at = now()`);
        return analysisOutput();
      },
    });
    await raiseNotification(client, { kind: KIND, message: 'earlier failure' });
    expect(await run(deps)).toMatchObject({ status: 'skipped' });
    expect(await row()).toMatchObject({ status: 'failed', error: 'reaped', result: null });
    // a superseded run must not close the admin's open failure notification
    expect(await listOpen(client)).toHaveLength(1);
  });
});

describe('runStandardAnalysis: skipping', () => {
  it('skips when the slot is done, running or exhausted, without calling any dependency', async () => {
    await addProvider();
    await run(makeDeps());
    const deps = makeDeps();
    expect(await run(deps)).toMatchObject({ status: 'skipped' });
    expect(deps.fetchPrices).not.toHaveBeenCalled();
    expect(deps.runAnalysis).not.toHaveBeenCalled();
  });
});

describe('runStandardAnalysis: failures', () => {
  it('no active provider: final failure at once, attempts 3, notification, notify(final:true)', async () => {
    await addProvider({ active: false });
    const deps = makeDeps();
    const out = await run(deps);
    expect(out).toMatchObject({ status: 'failed', attempts: 3, final: true });
    expect(out.error).toMatch(/provider/i);
    expect(await row()).toMatchObject({ status: 'failed', attempts: 3 });
    const open = await listOpen(client);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe(KIND);
    expect(open[0].message).toBe(`${SLOT}: No active AI provider — not retried`);
    expect(open[0].message).not.toMatch(/attempt/i);
    expect(deps.notify).toHaveBeenCalledWith({ event: KIND, slot: SLOT, error: out.error, attempts: 3, final: true });
    expect(deps.fetchPrices).not.toHaveBeenCalled();
    expect((await slotState(client, SLOT)).claimable).toBe(false);
  });

  it('prices throw: failed, attempt 1, notification opened, notify(final:false)', async () => {
    await addProvider();
    const deps = makeDeps({ fetchPrices: vi.fn(async () => { throw new Error('No gold price feed answered: gold-api: HTTP 503'); }) });
    const out = await run(deps);
    expect(out).toMatchObject({ status: 'failed', attempts: 1, final: false });
    expect(out.error).toContain('HTTP 503');
    const r = await row();
    expect(r).toMatchObject({ status: 'failed', attempts: 1 });
    expect(r.error).toContain('HTTP 503');
    expect(r.finished_at).not.toBeNull();
    const open = await listOpen(client);
    expect(open[0].message).toBe(`${SLOT}: ${out.error} (attempt 1 of 3)`);
    expect(deps.notify).toHaveBeenCalledWith({ event: KIND, slot: SLOT, error: out.error, attempts: 1, final: false });
    expect(deps.runAnalysis).not.toHaveBeenCalled();
  });

  it('analysis throws: failed with the message, error capped at 500 characters', async () => {
    await addProvider();
    const deps = makeDeps({ runAnalysis: vi.fn(async () => { throw new Error('x'.repeat(900)); }) });
    const out = await run(deps);
    expect(out.status).toBe('failed');
    expect(out.error).toHaveLength(500);
    expect((await row()).error).toHaveLength(500);
  });

  it('an aborted (timed-out) model call is a failure, not a hang', async () => {
    await addProvider();
    const deps = makeDeps({
      timeoutMs: 30,
      runAnalysis: vi.fn((p, s, r, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))),
    });
    const out = await run(deps);
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/time|abort/i);
  });

  it('a failing notify hook cannot break the run result', async () => {
    await addProvider();
    const deps = makeDeps({ fetchPrices: async () => { throw new Error('boom'); }, notify: async () => { throw new Error('hook down'); } });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(deps)).toMatchObject({ status: 'failed', attempts: 1 });
    errSpy.mockRestore();
  });

  it('an invalid snapshot (e.g. scenario weights not totalling 100) is a failure', async () => {
    await addProvider();
    await client.query(`UPDATE scenarios SET weight_pct = 50 WHERE user_id = $1`, [admin.id]);
    const deps = makeDeps();
    const out = await run(deps);
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/weights/i);
    expect(deps.runAnalysis).not.toHaveBeenCalled();
  });

  it('the notification is updated on each attempt and closed by a later success', async () => {
    await addProvider();
    const failing = makeDeps({ fetchPrices: async () => { throw new Error('down'); } });
    await run(failing);
    await age(SLOT, { finishedMin: 6 });
    const second = await run(failing);
    expect(second).toMatchObject({ status: 'failed', attempts: 2, final: false });
    const open = await listOpen(client);
    expect(open).toHaveLength(1);
    expect(open[0].message).toContain('(attempt 2 of 3)');
    await age(SLOT, { finishedMin: 6 });
    const third = await run(makeDeps());
    expect(third.status).toBe('done');
    expect((await row()).attempts).toBe(3);
    expect(await listOpen(client)).toEqual([]);
  });

  it('a third failure is final', async () => {
    await addProvider();
    const failing = makeDeps({ fetchPrices: async () => { throw new Error('down'); } });
    let last;
    for (let i = 0; i < 3; i++) {
      last = await run(failing);
      await age(SLOT, { finishedMin: 6 });
    }
    expect(last).toMatchObject({ attempts: 3, final: true });
    expect(await run(failing)).toMatchObject({ status: 'skipped' });
  });
});

describe('runStandardAnalysis: a stale attempt cannot overwrite a newer claim', () => {
  it('leaves the newer running claim alone and raises nothing', async () => {
    await addProvider();
    const deps = makeDeps({
      runAnalysis: async () => {
        await age(SLOT, { startedMin: 5 });
        expect(await claimSlot(client, SLOT)).not.toBeNull();
        throw new Error('late failure');
      },
    });
    expect(await run(deps)).toMatchObject({ status: 'skipped' });
    expect(await row()).toMatchObject({ status: 'running', attempts: 2 });
    expect(await listOpen(client)).toEqual([]);
    expect(deps.notify).not.toHaveBeenCalled();
  });
});

describe('runStandardAnalysis: manual (adhoc) slots', () => {
  it('a failed adhoc run does not raise the background notification but still calls notify', async () => {
    await addProvider();
    const deps = makeDeps({ fetchPrices: async () => { throw new Error('down'); } });
    const out = await run(deps, 'adhoc:1789000000000');
    expect(out.status).toBe('failed');
    expect(await listOpen(client)).toEqual([]);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });
});
