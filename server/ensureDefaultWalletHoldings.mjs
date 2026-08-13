export async function ensureDefaultWalletHoldings(db, userId) {
  const { rows } = await db.query('SELECT user_id FROM wallet_holdings WHERE user_id = $1', [userId]);
  if (rows.length > 0) return;

  await db.query('INSERT INTO wallet_holdings (user_id) VALUES ($1)', [userId]);
}
