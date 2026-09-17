import { describe, it, expect } from 'vitest';
import { buildAnalysisSnapshot } from '../../src/lib/analysisSnapshot';

const baseInput = {
  generatedAt: '2026-09-15T10:00:00.000Z',
  locale: 'en' as const,
  explanationLevel: 'expert' as const,
  spot: 2650,
  egp: 48.5,
  weightedTarget: 2700,
  scenarios: [
    { key: 'deesc' as const, nameEn: 'Geopolitical Changes', weightPct: 35, priceLo: 2400, priceHi: 2600, thesis: 'Tensions ease' },
    { key: 'base' as const, nameEn: 'Base Case', weightPct: 45, priceLo: 2600, priceHi: 2800, thesis: 'CB buying continues' },
    { key: 'stag' as const, nameEn: 'Stagflation Trap', weightPct: 20, priceLo: 2200, priceHi: 2500, thesis: 'Forced selling' },
  ],
  egypt: null,
  wallet: { hasHoldings: false, holdings: {}, intlValueEgp: 0, egyptValueEgp: null, costBasis: [] },
  dca: null,
  watchlist: [],
};

describe('buildAnalysisSnapshot', () => {
  it('requires fresh independently timestamped gold, FX and local prices', () => {
    const input = {...baseInput, marketRetrievedAt: {xau:'2026-09-15T09:50:00Z',fx:'2026-09-15T09:40:00Z'}, egypt:{retrievedAt:'2026-09-15T09:45:00Z',rows:[]}};
    expect(buildAnalysisSnapshot(input).price_alignment.premium_reliable).toBe(true);
    expect(buildAnalysisSnapshot({...input, generatedAt:'2026-09-16T10:00:00Z'}).price_alignment).toMatchObject({aligned:true,premium_reliable:false});
    expect(buildAnalysisSnapshot({...input,marketRetrievedAt:undefined}).price_alignment.premium_reliable).toBe(false);
    expect(buildAnalysisSnapshot({...input,marketRetrievedAt:{xau:null,fx:input.marketRetrievedAt.fx}}).price_alignment.premium_reliable).toBe(false);
  });
  it('is a plain JSON-serializable object with a schema_version and generated_at', () => {
    const snapshot = buildAnalysisSnapshot(baseInput);
    expect(snapshot.schema_version).toBe('2');
    expect(snapshot.generated_at).toBe('2026-09-15T10:00:00.000Z');
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('carries market numbers through untouched', () => {
    const snapshot = buildAnalysisSnapshot(baseInput);
    expect(snapshot.market).toMatchObject({ xau_usd: 2650, usd_egp: 48.5, weighted_target_usd: 2700 });
  });

  it('omits egypt when no snapshot is available', () => {
    const snapshot = buildAnalysisSnapshot(baseInput);
    expect(snapshot.egypt).toBeNull();
  });

  it('computes the local premium and implied gold-market dollar when Egypt prices are available', () => {
    // 24k sell of 4200 EGP/gram; theoretical intl price = (spot / 31.1035) * usd_egp
    const withEgypt = {
      ...baseInput,
      egypt: {
        retrievedAt: '2026-09-15T09:55:00.000Z',
        rows: [{ karat: '24k' as const, sell: 4200, buy: 4180 }],
      },
    };
    const snapshot = buildAnalysisSnapshot(withEgypt);
    expect(snapshot.egypt).not.toBeNull();
    const theoreticalIntlPerGram = (2650 / 31.1035) * 48.5;
    expect(snapshot.egypt!.implied_gold_market_usd_egp).toBeCloseTo(4200 / (2650 / 31.1035), 2);
    expect(snapshot.egypt!.local_premium_pct).toBeCloseTo(((4200 - theoreticalIntlPerGram) / theoreticalIntlPerGram) * 100, 2);
  });

  it('computes DCA status as open_now when the active window covers now', () => {
    const withDca = {
      ...baseInput,
      dca: {
        mode: 'fixed' as const,
        spacingMonths: 2,
        tranchePcts: [40, 35, 25],
        totalInvestmentEgp: 30000,
        monthlyInvestmentEgp: null,
        trancheStatus: ['done', 'active', 'pending'] as const,
        activeIndex: 1,
        nextPendingIndex: 2,
        windowStart: '2026-08-01T00:00:00.000Z',
        windowEnd: '2026-10-01T00:00:00.000Z',
      },
    };
    const snapshot = buildAnalysisSnapshot(withDca);
    expect(snapshot.dca).toEqual({
      mode: 'fixed',
      spacing_months: 2,
      tranche_split_pct: [40, 35, 25],
      monthly_investment_egp: null,
      total_investment_egp: 30000,
      status: 'open_now',
      window: { start: '2026-08-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      active_tranche_index: 1,
      current_installment_limit_egp: 10500,
    });
  });

  it('computes DCA status as next_window when nothing is active yet', () => {
    const withDca = {
      ...baseInput,
      dca: {
        mode: 'recurring' as const,
        spacingMonths: 1,
        tranchePcts: null,
        totalInvestmentEgp: null,
        monthlyInvestmentEgp: 5000,
        trancheStatus: ['pending'] as const,
        activeIndex: -1,
        nextPendingIndex: 0,
        windowStart: '2026-10-01T00:00:00.000Z',
        windowEnd: '2026-11-01T00:00:00.000Z',
      },
    };
    const snapshot = buildAnalysisSnapshot(withDca);
    expect(snapshot.dca!.status).toBe('next_window');
    expect(snapshot.dca!.active_tranche_index).toBeNull();
    expect(snapshot.dca!.monthly_investment_egp).toBe(5000);
    expect(snapshot.dca!.total_investment_egp).toBeNull();
  });

  it('rounds computed percentages and prices to 2 decimal places, never emitting float noise', () => {
    const withEgypt = {
      ...baseInput,
      egypt: { retrievedAt: '2026-09-15T09:55:00.000Z', rows: [{ karat: '24k' as const, sell: 4213.37, buy: 4180 }] },
    };
    const snapshot = buildAnalysisSnapshot(withEgypt);
    const str = JSON.stringify(snapshot.egypt!.local_premium_pct);
    expect(str.split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});
