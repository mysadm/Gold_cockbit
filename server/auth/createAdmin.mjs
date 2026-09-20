import { hashPassword, MIN_PASSWORD_LENGTH } from './password.mjs';
import { provisionUserDefaults } from '../provisionUserDefaults.mjs';
import { ensureDefaultLlmProvider } from '../ensureDefaultLlmProvider.mjs';

export async function createAdmin(db, { email, password, displayName }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('A valid email is required');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const existing = await db.query(`SELECT email FROM users WHERE role = 'admin' LIMIT 1`);
  if (existing.rows.length > 0) throw new Error(`An admin already exists (${existing.rows[0].email})`);

  const passwordHash = await hashPassword(password);
  const legacy = await db.query(`SELECT id FROM users WHERE email = 'default@local'`);

  let id;
  let converted;
  if (legacy.rows.length > 0) {
    id = legacy.rows[0].id;
    converted = true;
    await db.query(
      `UPDATE users SET email = $1, password_hash = $2, role = 'admin', status = 'active',
              display_name = COALESCE($3, display_name)
        WHERE id = $4`,
      [normalized, passwordHash, displayName || null, id]
    );
  } else {
    converted = false;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, role, status, display_name)
       VALUES ($1, $2, 'admin', 'active', $3) RETURNING id`,
      [normalized, passwordHash, displayName || null]
    );
    id = rows[0].id;
  }
  await provisionUserDefaults(db, id);
  await ensureDefaultLlmProvider(db, id);
  return { id, converted };
}
