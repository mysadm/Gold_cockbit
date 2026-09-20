import { describe, it, expect } from 'vitest';
import { buildMarketSnapshot } from '../../server/marketSnapshot.mjs';
import { buildAnalysisPrompt } from '../../server/prompts/buildAnalysisPrompt.mjs';
import { validateSnapshot } from '../../shared/analystContract.mjs';

const NOW = new Date('2026-09-20T10:00:00.000Z');
const PRICES = { spot: 4523, usdEgp: 48.57, goldSource: 'gold-api', retrievedAt: NOW.toISOString() };
const ROWS = [
  { name: 'A', band_low: 5800, band_high: 6300, weight_pct: 35 },
  { name: 'B', band_low: 5000, band_high: 5400, weight_pct: 45 },
  { name: 'C', band_low: 3600, band_high: 4000, weight_pct: 20 },
];
const PACK = [{ id: 'EV-001', title: 't', date: '2026-09-20', snippet: 's' }];

const marketSnapshot = () =>
  buildMarketSnapshot({ now: () => NOW, prices: PRICES, egypt: null, scenarioRows: ROWS, locale: 'ar', previousAnalysis: null });

describe('market-only analysis scope', () => {
  it('marks the server-built snapshot as a market-only analysis and keeps it valid', () => {
    const snapshot = marketSnapshot();
    expect(snapshot.analysis_scope).toBe('market');
    expect(validateSnapshot(snapshot)).toEqual([]);
  });

  it('tells the model that wallet, DCA and watchlist are absent by design, before the data', () => {
    const prompt = buildAnalysisPrompt(marketSnapshot(), PACK);
    const scopeAt = prompt.indexOf('STANDARD MARKET ANALYSIS');
    expect(scopeAt).toBeGreaterThan(-1);
    expect(scopeAt).toBeLessThan(prompt.indexOf('DATA_SNAPSHOT'));
    expect(prompt).toContain('absent by design');
    expect(prompt).toMatch(/never list (them|it) under missing_inputs/i);
    expect(prompt).toMatch(/insufficient_evidence only if the EVIDENCE_PACK/);
  });

  it('leaves the personalized prompt untouched when the snapshot has no market scope', () => {
    const { analysis_scope, ...personal } = marketSnapshot();
    expect(analysis_scope).toBe('market');
    const prompt = buildAnalysisPrompt(personal, PACK);
    expect(prompt).not.toContain('STANDARD MARKET ANALYSIS');
    expect(prompt).not.toContain('absent by design');
    expect(prompt).toContain('Omit wallet/dca/watchlist reads when absent.');
  });
});
