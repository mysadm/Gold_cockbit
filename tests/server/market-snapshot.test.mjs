import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { SCENARIO_META, loadScenarioRows, buildMarketSnapshot } from '../../server/marketSnapshot.mjs';
import { validateSnapshot } from '../../shared/analystContract.mjs';
import { buildAnalysisSnapshot } from '../../src/lib/analysisSnapshot';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

const NOW = new Date('2026-09-20T10:00:00.000Z');
const PRICES = { spot: 4523, usdEgp: 48.57, goldSource: 'gold-api', retrievedAt: NOW.toISOString() };
const EGYPT = {
  source: 'isagha.com',
  fetchedAt: '2026-09-20T09:58:00.000Z',
  rows: [
    { karat: '24k', sell: 7010.5, buy: 6950, changeAmount: 5.7, changePct: 0.08 },
    { karat: '21k', sell: 6135, buy: 6080, changeAmount: 1, changePct: 0.02 },
    { karat: 'gold_pound', sell: 49100, buy: 48700, changeAmount: null, changePct: null },
  ],
};
const ROWS = [
  { name: 'A', band_low: 5800, band_high: 6300, weight_pct: 35 },
  { name: 'B', band_low: 5000, band_high: 5400, weight_pct: 45 },
  { name: 'C', band_low: 3600, band_high: 4000, weight_pct: 20 },
];

const PREVIOUS = {
  generated_at: '2026-09-19T10:00:00.000Z',
  action: 'hold',
  confidence: 'medium',
  suggested_weights: { deesc: 30, base: 50, stag: 20 },
};

function clientSnapshot({ prices, egypt, rows, locale = 'en', previousAnalysis = null }) {
  const scenarios = SCENARIO_META_KEYS.map((key, i) => ({
    key,
    nameEn: EN[key].name,
    weightPct: rows[i].weight_pct,
    priceLo: rows[i].band_low,
    priceHi: rows[i].band_high,
    thesis: EN[key].thesis,
  }));
  const weightedTarget = scenarios.reduce((sum, s) => sum + (s.weightPct / 100) * ((s.priceLo + s.priceHi) / 2), 0);
  return buildAnalysisSnapshot({
    marketRetrievedAt: { xau: prices.retrievedAt, fx: prices.retrievedAt },
    previousAnalysis,
    generatedAt: NOW.toISOString(),
    locale,
    explanationLevel: 'beginner',
    spot: prices.spot,
    egp: prices.usdEgp,
    weightedTarget: Math.round(weightedTarget),
    scenarios,
    egypt: egypt
      ? { retrievedAt: egypt.fetchedAt, rows: egypt.rows.map((r) => ({ karat: r.karat, sell: r.sell, buy: r.buy })) }
      : null,
    wallet: { hasHoldings: false, holdings: {}, intlValueEgp: 0, egyptValueEgp: null, costBasis: [] },
    dca: null,
    watchlist: [],
  });
}

const SCENARIO_META_KEYS = ['deesc', 'base', 'stag'];
// Independent copy of T.en.scen in src/App.tsx, so drift in SCENARIO_META is caught.
const EN = {
  deesc: { name: 'Geopolitical Changes', thesis: 'Global geopolitical tensions ease broadly (not just Iran), Fed pivots, ETF inflows return' },
  base: { name: 'Base Case', thesis: 'CB buying ~720t/yr vs. elevated rates — grind higher' },
  stag: { name: 'Stagflation Trap', thesis: 'Fed hikes into weakness, dollar squeeze, forced selling' },
};

const strip = ({ generated_at, price_alignment, previous_analysis, ...rest }) => rest;

describe('SCENARIO_META', () => {
  it('matches the English scenario names and theses used by the client', () => {
    expect(Object.keys(SCENARIO_META)).toEqual(SCENARIO_META_KEYS);
    for (const key of SCENARIO_META_KEYS) {
      expect(SCENARIO_META[key]).toEqual({ name_en: EN[key].name, thesis: EN[key].thesis });
    }
  });
});

describe('buildMarketSnapshot', () => {
  it('is identical to the client builder for the same inputs (market, scenarios, egypt, wallet, dca, watchlist)', () => {
    const server = buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: EGYPT, scenarioRows: ROWS, locale: 'en' });
    const client = clientSnapshot({ prices: PRICES, egypt: EGYPT, rows: ROWS });
    expect(strip(server)).toEqual(strip(client));
    for (const k of ['market', 'scenarios', 'egypt', 'wallet', 'dca', 'watchlist']) {
      expect(server[k]).toEqual(client[k]);
    }
    expect(server.market.weighted_target_usd).toBe(Math.round(0.35 * 6050 + 0.45 * 5200 + 0.2 * 3800));
    expect(server.dca).toBeNull();
    expect(server.watchlist).toEqual([]);
    expect(server.wallet.has_holdings).toBe(false);
  });

  it('is identical to the client builder with fractional weights, a lopsided premium and no Egypt data', () => {
    const rows = [
      { name: 'A', band_low: 5801.25, band_high: 6300.5, weight_pct: 33.33 },
      { name: 'B', band_low: 5000, band_high: 5433.3, weight_pct: 33.33 },
      { name: 'C', band_low: 3600.75, band_high: 4000, weight_pct: 33.34 },
    ];
    const prices = { spot: 4111, usdEgp: 51.234, goldSource: 'binance-paxg', retrievedAt: '2026-09-20T09:30:00.000Z' };
    const egypt = { fetchedAt: '2026-09-20T09:40:00.000Z', rows: [{ karat: '24k', sell: 7777.77, buy: 7700 }] };
    for (const eg of [egypt, null]) {
      const server = buildMarketSnapshot({ now: () => NOW, prices, egypt: eg, scenarioRows: rows, locale: 'ar' });
      const client = clientSnapshot({ prices, egypt: eg, rows, locale: 'ar' });
      expect(strip(server)).toEqual(strip(client));
    }
  });

  it('limits Egypt rows to karat/sell/buy and uses retrievedAt for both market timestamps', () => {
    const s = buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: EGYPT, scenarioRows: ROWS, locale: 'en' });
    expect(s.market.xau_retrieved_at).toBe(PRICES.retrievedAt);
    expect(s.market.fx_retrieved_at).toBe(PRICES.retrievedAt);
    expect(s.egypt.rows[0]).toEqual({ karat: '24k', sell: 7010.5, buy: 6950 });
    expect(s.egypt.retrieved_at).toBe(EGYPT.fetchedAt);
    expect(s.generated_at).toBe(NOW.toISOString());
    expect(s.schema_version).toBe('2');
    expect(s.explanation_level).toBe('beginner');
  });

  it('carries previous_analysis and computes price_alignment like the client', () => {
    const server = buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: EGYPT, scenarioRows: ROWS, locale: 'en', previousAnalysis: PREVIOUS });
    const client = clientSnapshot({ prices: PRICES, egypt: EGYPT, rows: ROWS, previousAnalysis: PREVIOUS });
    expect(server.previous_analysis).toEqual(PREVIOUS);
    expect(server.price_alignment).toEqual(client.price_alignment);
    expect(buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: null, scenarioRows: ROWS, locale: 'en' }).previous_analysis).toBeNull();
  });

  it('passes validateSnapshot with no errors', () => {
    const s = buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: EGYPT, scenarioRows: ROWS, locale: 'en' });
    expect(validateSnapshot(s)).toEqual([]);
    const noEgypt = buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: null, scenarioRows: ROWS, locale: 'ar' });
    expect(validateSnapshot(noEgypt)).toEqual([]);
  });

  it('rejects anything other than exactly three scenario rows', () => {
    expect(() => buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: null, scenarioRows: ROWS.slice(0, 2), locale: 'en' })).toThrow(/3 scenarios/);
  });
});

describe('loadScenarioRows', () => {
  let client;
  let adminId;
  let otherId;

  beforeAll(async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    adminId = (await client.query(`INSERT INTO users (email, role, status) VALUES ('admin@x.com', 'admin', 'active') RETURNING id`)).rows[0].id;
    otherId = (await client.query(`INSERT INTO users (email, role, status) VALUES ('user@x.com', 'user', 'active') RETURNING id`)).rows[0].id;
  });
  afterAll(async () => {
    await client.end();
  });

  it('throws a clear error when the admin has no scenarios', async () => {
    await expect(loadScenarioRows(client, adminId)).rejects.toThrow(/3 scenarios/);
  });

  it("returns only the admin's three rows, ordered by sort_order, as numbers", async () => {
    await ensureDefaultScenarios(client, adminId);
    await client.query(
      `INSERT INTO scenarios (user_id, name, band_low, band_high, weight_pct, sort_order) VALUES ($1,'x',1,2,100,0)`,
      [otherId]
    );
    // reverse insertion order must not matter: shuffle sort_order
    await client.query(`UPDATE scenarios SET sort_order = 2 - sort_order WHERE user_id = $1`, [adminId]);
    const rows = await loadScenarioRows(client, adminId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.weight_pct)).toEqual([20, 45, 35]);
    expect(rows[0]).toEqual({ band_low: 3600, band_high: 4000, weight_pct: 20 });
    for (const r of rows) for (const v of Object.values(r)) expect(typeof v).toBe('number');
    // and the rows are usable directly
    expect(validateSnapshot(buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: null, scenarioRows: rows, locale: 'en' }))).toEqual([]);
  });

  it('throws when the admin has other than three scenarios', async () => {
    await client.query(`DELETE FROM scenarios WHERE user_id = $1 AND sort_order = 0`, [adminId]);
    await expect(loadScenarioRows(client, adminId)).rejects.toThrow(/exactly 3 scenarios.*found 2/);
    await client.query(
      `INSERT INTO scenarios (user_id, name, band_low, band_high, weight_pct, sort_order) VALUES ($1,'a',1,2,0,5),($1,'b',1,2,0,6)`,
      [adminId]
    );
    await expect(loadScenarioRows(client, adminId)).rejects.toThrow(/found 4/);
  });
});
