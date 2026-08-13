const DEFAULT_TOTAL_INVESTMENT_EGP = 300000;

export async function ensureDefaultDcaPlan(db, userId) {
  const { rows } = await db.query('SELECT user_id FROM dca_plan WHERE user_id = $1', [userId]);
  if (rows.length > 0) return;

  await db.query(
    `INSERT INTO dca_plan (user_id, start_date, total_investment_egp) VALUES ($1, CURRENT_DATE, $2)`,
    [userId, DEFAULT_TOTAL_INVESTMENT_EGP]
  );
}
