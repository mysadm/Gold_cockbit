const OZ_GRAMS = 31.1035;
const DEFAULT_MOVES_PCT = [-10, -5, 0, 5, 10];

export function computeSensitivityTable(
  input: { spot: number; egp: number; gramsAt24k: number },
  movesPct: number[] = DEFAULT_MOVES_PCT
): { xau_usd_move_pct: number; usd_egp_move_pct: number; wallet_value_egp: number }[] {
  if (input.gramsAt24k <= 0) return [];
  const rows: { xau_usd_move_pct: number; usd_egp_move_pct: number; wallet_value_egp: number }[] = [];
  for (const xauMove of movesPct) {
    for (const egpMove of movesPct) {
      const spot = input.spot * (1 + xauMove / 100);
      const egp = input.egp * (1 + egpMove / 100);
      const value = (spot / OZ_GRAMS) * egp * input.gramsAt24k;
      rows.push({ xau_usd_move_pct: xauMove, usd_egp_move_pct: egpMove, wallet_value_egp: Math.round(value * 100) / 100 });
    }
  }
  return rows;
}
