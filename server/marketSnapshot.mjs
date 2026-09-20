// Server-side, market-only AnalysisSnapshot builder. Mirrors
// `buildAnalysisSnapshot` in src/lib/analysisSnapshot.ts (same snake_case shape,
// formulas and rounding) for the parts a scheduled shared analysis can know:
// market, scenarios and Egypt. Wallet is always empty, dca null, watchlist [].
// Parity with the client builder is enforced by tests/server/market-snapshot.test.mjs.

const OZ_GRAMS = 31.1035;
const MAX_GAP_MINUTES = 60;

// Keys in scenarios.sort_order order (0, 1, 2). English names/theses are copied
// from T.en.scen in src/App.tsx.
export const SCENARIO_META = {
  deesc: {
    name_en: 'Geopolitical Changes',
    thesis: 'Global geopolitical tensions ease broadly (not just Iran), Fed pivots, ETF inflows return',
  },
  base: {
    name_en: 'Base Case',
    thesis: 'CB buying ~720t/yr vs. elevated rates — grind higher',
  },
  stag: {
    name_en: 'Stagflation Trap',
    thesis: 'Fed hikes into weakness, dollar squeeze, forced selling',
  },
};
const SCENARIO_KEYS = Object.keys(SCENARIO_META);

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function loadScenarioRows(db, adminId) {
  const { rows } = await db.query(
    `SELECT band_low, band_high, weight_pct
       FROM scenarios
      WHERE user_id = $1
      ORDER BY sort_order, id`,
    [adminId]
  );
  if (rows.length !== SCENARIO_KEYS.length) {
    throw new Error(`Admin must have exactly 3 scenarios to build a market snapshot (found ${rows.length})`);
  }
  return rows.map((r) => ({
    band_low: Number(r.band_low),
    band_high: Number(r.band_high),
    weight_pct: Number(r.weight_pct),
  }));
}

function buildEgypt(input, spot, egp) {
  if (!input) return null;
  const rows = input.rows ?? [];
  const row24k = rows.find((r) => r.karat === '24k');
  const theoreticalIntlPerGram = (spot / OZ_GRAMS) * egp;
  const impliedRate = row24k && theoreticalIntlPerGram > 0 ? row24k.sell / (spot / OZ_GRAMS) : null;
  const premiumPct = row24k && theoreticalIntlPerGram > 0
    ? ((row24k.sell - theoreticalIntlPerGram) / theoreticalIntlPerGram) * 100
    : null;
  return {
    retrieved_at: input.fetchedAt ?? input.retrievedAt,
    rows: rows.map((r) => ({ karat: r.karat, sell: r.sell, buy: r.buy })),
    implied_gold_market_usd_egp: impliedRate === null ? null : round2(impliedRate),
    local_premium_pct: premiumPct === null ? null : round2(premiumPct),
  };
}

export function buildMarketSnapshot({ now = () => new Date(), prices, egypt = null, scenarioRows, locale = 'en', previousAnalysis = null }) {
  if (!Array.isArray(scenarioRows) || scenarioRows.length !== SCENARIO_KEYS.length) {
    throw new Error('buildMarketSnapshot requires exactly 3 scenarios');
  }
  const generatedAt = now().toISOString();
  const spot = prices.spot;
  const egp = prices.usdEgp;

  const weightedTarget = scenarioRows.reduce(
    (sum, r) => sum + (r.weight_pct / 100) * ((r.band_low + r.band_high) / 2),
    0
  );

  const egyptBlock = buildEgypt(egypt, spot, egp);

  const times = [prices.retrievedAt, prices.retrievedAt, egyptBlock?.retrieved_at].map((t) => (t ? Date.parse(t) : NaN));
  const complete = times.every(Number.isFinite);
  const gap = complete ? (Math.max(...times) - Math.min(...times)) / 60000 : null;
  const nowMs = Date.parse(generatedAt);
  const fresh = complete && times.every((t) => t <= nowMs && nowMs - t <= 60 * 60000);

  return {
    schema_version: '2',
    analysis_scope: 'market',
    generated_at: generatedAt,
    locale,
    explanation_level: 'beginner',
    market: {
      xau_usd: spot,
      usd_egp: egp,
      weighted_target_usd: Math.round(weightedTarget),
      xau_retrieved_at: prices.retrievedAt ?? null,
      fx_retrieved_at: prices.retrievedAt ?? null,
    },
    price_alignment: {
      aligned: gap !== null && gap <= MAX_GAP_MINUTES,
      premium_reliable: fresh && gap !== null && gap <= MAX_GAP_MINUTES,
      age_gap_minutes: gap === null ? null : round2(gap),
      max_gap_minutes: MAX_GAP_MINUTES,
    },
    previous_analysis: previousAnalysis ?? null,
    scenarios: SCENARIO_KEYS.map((key, i) => ({
      key,
      name_en: SCENARIO_META[key].name_en,
      weight_pct: scenarioRows[i].weight_pct,
      price_lo: scenarioRows[i].band_low,
      price_hi: scenarioRows[i].band_high,
      thesis: SCENARIO_META[key].thesis,
    })),
    egypt: egyptBlock,
    wallet: {
      has_holdings: false,
      holdings: {},
      value_intl_egp: 0,
      value_egypt_egp: null,
      cost_basis: [],
    },
    dca: null,
    watchlist: [],
  };
}
