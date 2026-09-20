import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
beforeEach(async () => { client = await resetAndMigrate(MIGRATIONS_DIR); });
afterEach(async () => { await client.end(); });

const count = async (table, userId) =>
  (await client.query(`SELECT count(*)::int n FROM ${table} WHERE user_id = $1`, [userId])).rows[0].n;

describe('provisionUserDefaults', () => {
  it('gives a new user scenarios, tranches, a DCA plan and wallet holdings, and is idempotent', async () => {
    const u = await createTestUser(client, { email: 'n@x.com' });
    await provisionUserDefaults(client, u.id);
    await provisionUserDefaults(client, u.id);
    expect(await count('scenarios', u.id)).toBe(3);
    expect(await count('tranches', u.id)).toBe(3);
    expect(await count('dca_plan', u.id)).toBe(1);
    expect(await count('wallet_holdings', u.id)).toBeGreaterThan(0);
  });

  it('does not create an AI provider (those belong to the admin)', async () => {
    const u = await createTestUser(client, { email: 'n@x.com' });
    await provisionUserDefaults(client, u.id);
    expect(await count('llm_providers', u.id)).toBe(0);
  });
});
