const DEFAULT_TRANCHES = [
  { tranche_number: 1, plan_pct: 40 },
  { tranche_number: 2, plan_pct: 35 },
  { tranche_number: 3, plan_pct: 25 },
];

export async function ensureDefaultTranches(db, userId) {
  const { rows } = await db.query('SELECT id FROM tranches WHERE user_id = $1 LIMIT 1', [userId]);
  if (rows.length > 0) return;

  for (const tranche of DEFAULT_TRANCHES) {
    await db.query(
      `INSERT INTO tranches (user_id, tranche_number, plan_pct) VALUES ($1, $2, $3)`,
      [userId, tranche.tranche_number, tranche.plan_pct]
    );
  }
}
