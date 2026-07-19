import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultUser', () => {
  it('creates the default user on first call', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const userId = await ensureDefaultUser(client);

    const { rows } = await client.query('SELECT id, email FROM users WHERE id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('default@local');
  });

  it('is idempotent — calling twice returns the same user id and creates no duplicate', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const firstId = await ensureDefaultUser(client);
    const secondId = await ensureDefaultUser(client);

    expect(secondId).toBe(firstId);

    const { rows } = await client.query('SELECT id FROM users');
    expect(rows).toHaveLength(1);
  });
});
