import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { createAdmin } from '../../server/auth/createAdmin.mjs';
import { verifyPassword, MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '../../server/auth/password.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
beforeEach(async () => { client = await resetAndMigrate(MIGRATIONS_DIR); });
afterEach(async () => { await client.end(); });

describe('createAdmin', () => {
  it('converts the default@local user, keeping its id and data', async () => {
    const defaultId = await ensureDefaultUser(client);
    await ensureDefaultScenarios(client, defaultId);
    await client.query(`UPDATE scenarios SET weight_pct = 61 WHERE user_id = $1 AND sort_order = 0`, [defaultId]);

    const result = await createAdmin(client, { email: ' Boss@Example.com ', password: 'a-good-password', displayName: 'Boss' });

    expect(result).toEqual({ id: defaultId, converted: true });
    const { rows } = await client.query('SELECT email, role, status, display_name, password_hash FROM users WHERE id = $1', [defaultId]);
    expect(rows[0]).toMatchObject({ email: 'boss@example.com', role: 'admin', status: 'active', display_name: 'Boss' });
    expect(await verifyPassword('a-good-password', rows[0].password_hash)).toBe(true);
    const w = await client.query('SELECT weight_pct FROM scenarios WHERE user_id = $1 AND sort_order = 0', [defaultId]);
    expect(Number(w.rows[0].weight_pct)).toBe(61);
  });

  it('creates a fresh admin with defaults and a default AI provider on an empty database', async () => {
    const result = await createAdmin(client, { email: 'boss@example.com', password: 'a-good-password' });
    expect(result.converted).toBe(false);
    const { rows } = await client.query('SELECT role, status FROM users WHERE id = $1', [result.id]);
    expect(rows[0]).toEqual({ role: 'admin', status: 'active' });
    expect((await client.query('SELECT count(*)::int n FROM scenarios WHERE user_id = $1', [result.id])).rows[0].n).toBe(3);
    expect((await client.query('SELECT count(*)::int n FROM llm_providers WHERE user_id = $1', [result.id])).rows[0].n).toBe(1);
  });

  it('refuses when an admin already exists, and on a short password', async () => {
    await createTestUser(client, { email: 'first@x.com', role: 'admin' });
    await expect(createAdmin(client, { email: 'second@x.com', password: 'a-good-password' }))
      .rejects.toThrow(/admin already exists/i);
    await client.query('DELETE FROM users');
    await expect(createAdmin(client, { email: 'x@x.com', password: 'short' })).rejects.toThrow(/at least 8/);
  });

  it('rejects an over-long email or password before writing anything', async () => {
    const longEmail = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`;
    await expect(createAdmin(client, { email: longEmail, password: 'a-good-password' })).rejects.toThrow(/email/i);
    await expect(createAdmin(client, { email: 'x@x.com', password: 'p'.repeat(MAX_PASSWORD_LENGTH + 1) }))
      .rejects.toThrow(/at most 1024/);
    expect((await client.query('SELECT count(*)::int n FROM users')).rows[0].n).toBe(0);
  });
});
