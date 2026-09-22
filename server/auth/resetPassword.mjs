// A server-side password reset for when nobody can log in to use the admin
// "Reset password" button (for example: the very first admin, or a typo'd email
// fixed by hand). Does not require any existing session.
import { hashPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, MAX_EMAIL_LENGTH } from './password.mjs';

export async function resetPasswordByEmail(db, { email, password }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (normalized.length > MAX_EMAIL_LENGTH) throw new Error(`Email must be at most ${MAX_EMAIL_LENGTH} characters`);
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);

  const passwordHash = await hashPassword(password);
  const { rows } = await db.query(
    `UPDATE users SET password_hash = $2 WHERE email = $1 RETURNING id, role`,
    [normalized, passwordHash]
  );
  if (!rows.length) throw new Error(`No user with email ${normalized}`);
  return { id: rows[0].id, role: rows[0].role };
}
