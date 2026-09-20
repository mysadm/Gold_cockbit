import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { setSetting } from '../../server/appSettings.mjs';
import { runDueAnalysis, startAnalysisScheduler, loadSchedule } from '../../server/analysisScheduler.mjs';
import { slotState } from '../../server/standardAnalysis.mjs';
import { currentSlot, normalizeSchedule } from '../../server/analysisSchedule.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
const SCHEDULE = { enabled: true, times: ['08:00', '16:00'], tz: 'UTC', language: 'en' };
// 10:00 UTC on 2026-09-20 is in slot 2026-09-20@08:00; 17:00 is in 2026-09-20@16:00.
const AT_10 = new Date('2026-09-20T10:00:00.000Z');
const AT_17 = new Date('2026-09-20T17:00:00.000Z');
const SLOT_08 = '2026-09-20@08:00';
const SLOT_16 = '2026-09-20@16:00';

let client, admin, clock;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin' });
  await provisionUserDefaults(client, admin.id);
  await client.query(`INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'ollama', 'P', 'm', true)`, [admin.id]);
  clock = AT_10;
});
afterEach(async () => { await client.end(); vi.useRealTimers(); });

const parsed = {
  schema_version: '3', status: 'insufficient_evidence',
  primary_decision: { action: 'hold', horizon: 'now', confidence: 'low', headline: 'h', next_trigger: 'n', invalidation: 'i' },
  suggested_weights: { deesc: 35, base: 45, stag: 20 }, evidence: [], weight_changes: [], reads: { egp: 'e' }, assumptions: [], missing_inputs: [],
};
function makeDeps(over = {}) {
  return {
    fetchPrices: vi.fn(async () => ({ spot: 4500, usdEgp: 48.5, goldSource: 'gold-api', retrievedAt: clock.toISOString() })),
    fetchEgypt: vi.fn(async () => ({ source: 'isagha.com', fetchedAt: clock.toISOString(), rows: [{ karat: '24k', sell: 7000, buy: 6950 }] })),
    runAnalysis: vi.fn(async () => ({ text: JSON.stringify(parsed), result: parsed, validation: { ok: true, errors: [] }, usedWebSearch: false, searchStatus: 'disabled', evidenceSources: [] })),
    notify: vi.fn(async () => {}),
    ...over,
  };
}
const tick = (deps) => runDueAnalysis({ db: client, adminId: admin.id, now: () => clock, deps });
const enable = (over = {}) => setSetting(client, 'analysis_schedule', { ...SCHEDULE, ...over });
const runs = async () => (await client.query('SELECT slot_key, status, attempts FROM shared_analysis_runs ORDER BY slot_key')).rows;
const ageFailed = (slot) => client.query(`UPDATE shared_analysis_runs SET finished_at = now() - interval '6 minutes' WHERE slot_key = $1`, [slot]);

describe('loadSchedule', () => {
  it('defaults to a disabled schedule when nothing is stored', async () => {
    expect(await loadSchedule(client)).toMatchObject({ enabled: false, tz: 'Africa/Cairo' });
  });
  it('falls back to the disabled default (without throwing) when the stored value is invalid', async () => {
    for (const bad of [{ enabled: true, times: ['25:99'] }, { enabled: true, tz: 'Mars/Base' }, 'x', [], 5]) {
      await setSetting(client, 'analysis_schedule', bad);
      expect(await loadSchedule(client)).toMatchObject({ enabled: false });
    }
  });
  it('returns the normalized stored schedule', async () => {
    await enable({ times: ['16:00', '08:00', '08:00'] });
    expect(await loadSchedule(client)).toEqual({ enabled: true, times: ['08:00', '16:00'], tz: 'UTC', language: 'en' });
  });
});

describe('runDueAnalysis', () => {
  it('does nothing when the schedule is disabled (default and explicit)', async () => {
    const deps = makeDeps();
    expect(await tick(deps)).toMatchObject({ ran: false });
    await enable({ enabled: false });
    expect(await tick(deps)).toMatchObject({ ran: false });
    expect(deps.fetchPrices).not.toHaveBeenCalled();
    expect(await runs()).toEqual([]);
  });

  it('sweeps a stranded final attempt at the start of every tick, even when the schedule is disabled', async () => {
    await enable({ enabled: false });
    await client.query(
      `INSERT INTO shared_analysis_runs (slot_key, status, attempts, started_at) VALUES ($1, 'running', 3, now() - interval '10 minutes')`, [SLOT_08]
    );
    const deps = makeDeps();
    expect(await tick(deps)).toMatchObject({ ran: false, reason: 'disabled' });
    expect(await runs()).toEqual([{ slot_key: SLOT_08, status: 'failed', attempts: 3 }]);
    const { rows } = await client.query(`SELECT message FROM admin_notifications WHERE resolved_at IS NULL`);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toContain('not retried');
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ slot: SLOT_08, attempts: 3, final: true }));
    expect(deps.fetchPrices).not.toHaveBeenCalled();
  });

  it('runs the current slot once across two ticks', async () => {
    await enable();
    const deps = makeDeps();
    const first = await tick(deps);
    expect(first).toMatchObject({ ran: true, result: { status: 'done' } });
    expect(await tick(deps)).toMatchObject({ ran: false });
    expect(deps.runAnalysis).toHaveBeenCalledTimes(1);
    expect(await runs()).toEqual([{ slot_key: SLOT_08, status: 'done', attempts: 1 }]);
  });

  it('does not run when the slot is already done', async () => {
    await enable();
    await client.query(`INSERT INTO shared_analysis_runs (slot_key, status, result, finished_at) VALUES ($1, 'done', '{}'::jsonb, now())`, [SLOT_08]);
    const deps = makeDeps();
    expect(await tick(deps)).toMatchObject({ ran: false });
    expect(deps.fetchPrices).not.toHaveBeenCalled();
  });

  it('catches up after downtime: a clock in the next slot runs the new slot once', async () => {
    await enable();
    const deps = makeDeps();
    await tick(deps); // slot 08:00 done
    clock = AT_17;    // "server was down" past 16:00
    expect(await tick(deps)).toMatchObject({ ran: true, result: { status: 'done' } });
    expect(await tick(deps)).toMatchObject({ ran: false });
    expect((await runs()).map((r) => r.slot_key)).toEqual([SLOT_08, SLOT_16]);
    expect(deps.runAnalysis).toHaveBeenCalledTimes(2);
    // the second run is stamped with the scheduler clock
    const snap = deps.runAnalysis.mock.calls[1][1];
    expect(snap.generated_at).toBe(AT_17.toISOString());
  });

  it('uses the slot from currentSlot(now, normalizeSchedule(...))', async () => {
    await enable();
    await tick(makeDeps());
    expect((await runs())[0].slot_key).toBe(currentSlot(AT_10, normalizeSchedule(SCHEDULE)).key);
  });

  it('a failure is not retried within 5 minutes, is retried after, up to 3 attempts, then never again in that slot', async () => {
    await enable();
    const failing = makeDeps({ fetchPrices: vi.fn(async () => { throw new Error('feeds down'); }) });
    expect(await tick(failing)).toMatchObject({ ran: true, result: { status: 'failed', attempts: 1, final: false } });
    expect(await tick(failing)).toMatchObject({ ran: false });
    expect(failing.fetchPrices).toHaveBeenCalledTimes(1);

    await ageFailed(SLOT_08);
    expect(await tick(failing)).toMatchObject({ ran: true, result: { attempts: 2, final: false } });
    expect(await tick(failing)).toMatchObject({ ran: false });

    await ageFailed(SLOT_08);
    expect(await tick(failing)).toMatchObject({ ran: true, result: { attempts: 3, final: true } });

    await ageFailed(SLOT_08);
    expect(await tick(failing)).toMatchObject({ ran: false });
    expect(failing.fetchPrices).toHaveBeenCalledTimes(3);
    expect(await slotState(client, SLOT_08)).toMatchObject({ state: 'failed', attempts: 3, claimable: false });
    expect(failing.notify).toHaveBeenCalledTimes(3);
  });

  it('a stale running claim (crashed process) is picked up on a later tick', async () => {
    await enable();
    await client.query(`INSERT INTO shared_analysis_runs (slot_key, status, started_at) VALUES ($1, 'running', now() - interval '5 minutes')`, [SLOT_08]);
    expect(await tick(makeDeps())).toMatchObject({ ran: true, result: { status: 'done' } });
    expect((await runs())[0].attempts).toBe(2);
  });

  it('a fresh running claim by another process blocks the tick', async () => {
    await enable();
    await client.query(`INSERT INTO shared_analysis_runs (slot_key, status) VALUES ($1, 'running')`, [SLOT_08]);
    const deps = makeDeps();
    expect(await tick(deps)).toMatchObject({ ran: false });
    expect(deps.fetchPrices).not.toHaveBeenCalled();
  });

  it('accepts a plain Date for now', async () => {
    await enable();
    const out = await runDueAnalysis({ db: client, adminId: admin.id, now: AT_10, deps: makeDeps() });
    expect(out.ran).toBe(true);
  });
});

describe('startAnalysisScheduler', () => {
  it('ticks on the interval, guards against re-entrancy, and stop() ends it', async () => {
    await enable();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const deps = makeDeps({ fetchPrices: vi.fn(async () => { await gate; return { spot: 4500, usdEgp: 48.5, goldSource: 'g', retrievedAt: AT_10.toISOString() }; }), now: () => AT_10 });
    const stop = startAnalysisScheduler({ db: client, adminId: admin.id, deps, intervalMs: 1000 });
    expect(typeof stop).toBe('function');

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(deps.fetchPrices).toHaveBeenCalledTimes(1));
    // The first run is still in flight: further ticks must not start another one.
    await vi.advanceTimersByTimeAsync(3000);
    expect(deps.fetchPrices).toHaveBeenCalledTimes(1);

    release();
    await vi.waitFor(async () => expect((await runs())[0]?.status).toBe('done'));
    await vi.advanceTimersByTimeAsync(1000); // next tick: slot is done, nothing more runs
    expect(deps.runAnalysis).toHaveBeenCalledTimes(1);

    stop();
    await enable({ times: ['08:00', '10:00'] }); // would be a new slot if the scheduler were still alive
    await vi.advanceTimersByTimeAsync(5000);
    expect(deps.runAnalysis).toHaveBeenCalledTimes(1);
  });

  it('logs a tick error and keeps going instead of throwing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { query: vi.fn(async () => { throw new Error('db gone'); }) };
    const stop = startAnalysisScheduler({ db: broken, adminId: admin.id, deps: makeDeps(), intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(broken.query.mock.calls.length).toBeGreaterThanOrEqual(2));
    stop();
    errSpy.mockRestore();
  });

  it('unrefs its timer so it never keeps the process alive', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const stop = startAnalysisScheduler({ db: client, adminId: admin.id, deps: makeDeps(), intervalMs: 60_000 });
    const timer = spy.mock.results[0].value;
    expect(timer.hasRef()).toBe(false);
    stop();
    spy.mockRestore();
  });
});
