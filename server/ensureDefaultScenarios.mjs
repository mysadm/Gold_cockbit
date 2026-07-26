const DEFAULT_SCENARIOS = [
  { name: 'De-escalation', band_low: 5800, band_high: 6300, weight_pct: 35, sort_order: 0 },
  { name: 'Base Case', band_low: 5000, band_high: 5400, weight_pct: 45, sort_order: 1 },
  { name: 'Stagflation Trap', band_low: 3600, band_high: 4000, weight_pct: 20, sort_order: 2 },
];

export async function ensureDefaultScenarios(db, userId) {
  const { rows } = await db.query('SELECT id FROM scenarios WHERE user_id = $1 LIMIT 1', [userId]);
  if (rows.length > 0) return;

  for (const scenario of DEFAULT_SCENARIOS) {
    await db.query(
      `INSERT INTO scenarios (user_id, name, band_low, band_high, weight_pct, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, scenario.name, scenario.band_low, scenario.band_high, scenario.weight_pct, scenario.sort_order]
    );
  }
}
