import { describe, it, expect } from 'vitest';
import { computeSensitivityTable } from '../../src/lib/sensitivity';

describe('computeSensitivityTable', () => {
  it('computes wallet EGP value at each combination of XAU/USD and USD/EGP moves', () => {
    const table = computeSensitivityTable({ spot: 2650, egp: 48.5, gramsAt24k: 100 }, [-10, 0, 10]);
    // at 0% move: value = (2650/31.1035) * 48.5 * 100
    const base = (2650 / 31.1035) * 48.5 * 100;
    const baseRow = table.find((r) => r.xau_usd_move_pct === 0 && r.usd_egp_move_pct === 0);
    expect(baseRow?.wallet_value_egp).toBeCloseTo(base, 0);
  });

  it('produces one row per combination of the given move percentages', () => {
    const table = computeSensitivityTable({ spot: 2650, egp: 48.5, gramsAt24k: 50 }, [-10, 10]);
    expect(table.length).toBe(4); // 2 x 2 combinations
  });

  it('returns an empty table when gramsAt24k is zero (no holdings to size)', () => {
    const table = computeSensitivityTable({ spot: 2650, egp: 48.5, gramsAt24k: 0 });
    expect(table).toEqual([]);
  });
});
