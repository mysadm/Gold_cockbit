import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultTranches } from '../../server/ensureDefaultTranches.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultTranches', () => {
  it('seeds exactly 3 tranches with the 40/35/25 plan', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultTranches(client, userId);

    const { rows } = await client.query(
      'SELECT tranche_number, plan_pct, status FROM tranches WHERE user_id = $1 ORDER BY tranche_number',
      [userId]
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.tranche_number)).toEqual([1, 2, 3]);
    expect(rows.map((r) => Number(r.plan_pct))).toEqual([40, 35, 25]);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultTranches(client, userId);
    await ensureDefaultTranches(client, userId);

    const { rows } = await client.query('SELECT id FROM tranches WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(3);
  });
});
