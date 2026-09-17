const OZ_GRAMS = 31.1035;

export type SnapshotScenario = {
  key: 'deesc' | 'base' | 'stag';
  nameEn: string;
  weightPct: number;
  priceLo: number;
  priceHi: number;
  thesis: string;
};

export type SnapshotEgyptInput = {
  retrievedAt: string;
  rows: { karat: '24k' | '22k' | '21k' | '18k' | 'gold_pound'; sell: number; buy: number }[];
};

export type SnapshotWalletInput = {
  hasHoldings: boolean;
  holdings: Record<string, number>;
  intlValueEgp: number;
  egyptValueEgp: number | null;
  costBasis: { unit: string; avgCostEgp: number; openQty: number; realizedEgp: number }[];
};

export type SnapshotDcaInput = {
  mode: 'fixed' | 'recurring';
  spacingMonths: number;
  tranchePcts: number[] | null;
  totalInvestmentEgp: number | null;
  monthlyInvestmentEgp: number | null;
  trancheStatus: readonly ('done' | 'active' | 'pending')[];
  activeIndex: number;
  nextPendingIndex: number;
  windowStart: string | null;
  windowEnd: string | null;
};

export type BuildSnapshotInput = {
  generatedAt: string;
  marketRetrievedAt?: { xau: string | null; fx: string | null };
  previousAnalysis?: PreviousAnalysis | null;
  locale: 'ar' | 'en';
  explanationLevel: 'beginner' | 'expert';
  spot: number;
  egp: number;
  weightedTarget: number;
  scenarios: SnapshotScenario[];
  egypt: SnapshotEgyptInput | null;
  wallet: SnapshotWalletInput;
  dca: SnapshotDcaInput | null;
  watchlist: { id: string; label: string; signal: 'supportive' | 'watch' | 'risk' }[];
};

export type PreviousAnalysis = {
  generated_at: string;
  action: string;
  confidence: 'low' | 'medium' | 'high';
  suggested_weights: { deesc: number; base: number; stag: number };
};
export type AnalysisSnapshot = {
  schema_version: '2';
  generated_at: string;
  locale: 'ar' | 'en';
  explanation_level: 'beginner' | 'expert';
  market: { xau_usd: number; usd_egp: number; weighted_target_usd: number; xau_retrieved_at: string | null; fx_retrieved_at: string | null };
  price_alignment: { aligned: boolean; premium_reliable: boolean; age_gap_minutes: number | null; max_gap_minutes: number };
  previous_analysis: PreviousAnalysis | null;
  scenarios: { key: string; name_en: string; weight_pct: number; price_lo: number; price_hi: number; thesis: string }[];
  egypt: {
    retrieved_at: string;
    rows: { karat: string; sell: number; buy: number }[];
    implied_gold_market_usd_egp: number | null;
    local_premium_pct: number | null;
  } | null;
  wallet: {
    has_holdings: boolean;
    holdings: Record<string, number>;
    value_intl_egp: number;
    value_egypt_egp: number | null;
    cost_basis: { unit: string; avg_cost_egp: number; open_qty: number; realized_egp: number }[];
  };
  dca: {
    mode: 'fixed' | 'recurring';
    spacing_months: number;
    tranche_split_pct: number[] | null;
    monthly_investment_egp: number | null;
    total_investment_egp: number | null;
    status: 'open_now' | 'next_window' | 'all_complete';
    window: { start: string; end: string } | null;
    active_tranche_index: number | null;
  } | null;
  watchlist: { id: string; label: string; signal: 'supportive' | 'watch' | 'risk' }[];
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildEgypt(input: SnapshotEgyptInput | null, spot: number, egp: number): AnalysisSnapshot['egypt'] {
  if (!input) return null;
  const row24k = input.rows.find((r) => r.karat === '24k');
  const theoreticalIntlPerGram = (spot / OZ_GRAMS) * egp;
  const impliedRate = row24k && theoreticalIntlPerGram > 0 ? row24k.sell / (spot / OZ_GRAMS) : null;
  const premiumPct = row24k && theoreticalIntlPerGram > 0
    ? ((row24k.sell - theoreticalIntlPerGram) / theoreticalIntlPerGram) * 100
    : null;
  return {
    retrieved_at: input.retrievedAt,
    rows: input.rows.map((r) => ({ karat: r.karat, sell: r.sell, buy: r.buy })),
    implied_gold_market_usd_egp: impliedRate === null ? null : round2(impliedRate),
    local_premium_pct: premiumPct === null ? null : round2(premiumPct),
  };
}

function buildDca(input: SnapshotDcaInput | null): AnalysisSnapshot['dca'] {
  if (!input) return null;
  const status: 'open_now' | 'next_window' | 'all_complete' =
    input.activeIndex >= 0 ? 'open_now' : input.nextPendingIndex >= 0 ? 'next_window' : 'all_complete';
  return {
    mode: input.mode,
    spacing_months: input.spacingMonths,
    tranche_split_pct: input.tranchePcts,
    monthly_investment_egp: input.monthlyInvestmentEgp,
    total_investment_egp: input.totalInvestmentEgp,
    status,
    window: input.windowStart && input.windowEnd && status !== 'all_complete'
      ? { start: input.windowStart, end: input.windowEnd }
      : null,
    active_tranche_index: input.activeIndex >= 0 ? input.activeIndex : null,
  };
}

export function buildAnalysisSnapshot(input: BuildSnapshotInput): AnalysisSnapshot {
  const times = [input.marketRetrievedAt?.xau, input.marketRetrievedAt?.fx, input.egypt?.retrievedAt].map(t => t ? Date.parse(t) : NaN);
  const complete = times.every(Number.isFinite);
  const gap = complete ? (Math.max(...times) - Math.min(...times)) / 60000 : null;
  const now = Date.parse(input.generatedAt);
  const fresh = complete && times.every(t => t <= now && now - t <= 60 * 60000);
  return {
    schema_version: '2',
    generated_at: input.generatedAt,
    locale: input.locale,
    explanation_level: input.explanationLevel,
    market: { xau_usd: input.spot, usd_egp: input.egp, weighted_target_usd: input.weightedTarget, xau_retrieved_at: input.marketRetrievedAt?.xau ?? null, fx_retrieved_at: input.marketRetrievedAt?.fx ?? null },
    price_alignment: { aligned: gap !== null && gap <= 60, premium_reliable: fresh && gap !== null && gap <= 60, age_gap_minutes: gap === null ? null : round2(gap), max_gap_minutes: 60 },
    previous_analysis: input.previousAnalysis ?? null,
    scenarios: input.scenarios.map((s) => ({
      key: s.key,
      name_en: s.nameEn,
      weight_pct: s.weightPct,
      price_lo: s.priceLo,
      price_hi: s.priceHi,
      thesis: s.thesis,
    })),
    egypt: buildEgypt(input.egypt, input.spot, input.egp),
    wallet: {
      has_holdings: input.wallet.hasHoldings,
      holdings: input.wallet.holdings,
      value_intl_egp: round2(input.wallet.intlValueEgp),
      value_egypt_egp: input.wallet.egyptValueEgp === null ? null : round2(input.wallet.egyptValueEgp),
      cost_basis: input.wallet.costBasis.map((cb) => ({
        unit: cb.unit,
        avg_cost_egp: round2(cb.avgCostEgp),
        open_qty: cb.openQty,
        realized_egp: round2(cb.realizedEgp),
      })),
    },
    dca: buildDca(input.dca),
    watchlist: input.watchlist,
  };
}
