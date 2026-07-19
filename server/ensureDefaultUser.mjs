const DEFAULT_USER_EMAIL = 'default@local';

export async function ensureDefaultUser(db) {
  await db.query(
    'INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING',
    [DEFAULT_USER_EMAIL]
  );
  const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [DEFAULT_USER_EMAIL]);
  return rows[0].id;
}
