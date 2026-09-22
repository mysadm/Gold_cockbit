import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { resetPasswordByEmail } from '../../server/auth/resetPassword.mjs';
import { verifyPassword, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '../../server/auth/password.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
beforeEach(async () => { client = await resetAndMigrate(MIGRATIONS_DIR); });
afterEach(async () => { await client.end(); });

describe('resetPasswordByEmail', () => {
  it('sets a new password for an existing user, matched case-insensitively', async () => {
    const admin = await createTestUser(client, { email: 'boss@example.com', role: 'admin' });

    const result = await resetPasswordByEmail(client, { email: ' Boss@Example.com ', password: 'a-new-password' });

    expect(result).toEqual({ id: admin.id, role: 'admin' });
    const { rows } = await client.query('SELECT password_hash FROM users WHERE id = $1', [admin.id]);
    expect(await verifyPassword('a-new-password', rows[0].password_hash)).toBe(true);
    expect(await verifyPassword(admin.password, rows[0].password_hash)).toBe(false);
  });

  it('does not change role or status', async () => {
    const user = await createTestUser(client, { email: 'plain@x.com', role: 'user', status: 'disabled' });
    await resetPasswordByEmail(client, { email: 'plain@x.com', password: 'a-new-password' });
    const { rows } = await client.query('SELECT role, status FROM users WHERE id = $1', [user.id]);
    expect(rows[0]).toEqual({ role: 'user', status: 'disabled' });
  });

  it('rejects an unknown email without changing anything', async () => {
    await createTestUser(client, { email: 'boss@example.com', role: 'admin' });
    await expect(resetPasswordByEmail(client, { email: 'nope@x.com', password: 'a-new-password' })).rejects.toThrow(/no user/i);
  });

  it('rejects a short or over-long password, and an over-long email, before writing anything', async () => {
    const admin = await createTestUser(client, { email: 'boss@example.com', role: 'admin' });
    await expect(resetPasswordByEmail(client, { email: 'boss@example.com', password: 'short' })).rejects.toThrow(/at least 8/);
    await expect(resetPasswordByEmail(client, { email: 'boss@example.com', password: 'p'.repeat(MAX_PASSWORD_LENGTH + 1) })).rejects.toThrow(/at most/);
    await expect(resetPasswordByEmail(client, { email: `${'a'.repeat(MAX_EMAIL_LENGTH)}@x.com`, password: 'a-new-password' })).rejects.toThrow(/email/i);
    const { rows } = await client.query('SELECT password_hash FROM users WHERE id = $1', [admin.id]);
    expect(await verifyPassword(admin.password, rows[0].password_hash)).toBe(true);
  });
});
