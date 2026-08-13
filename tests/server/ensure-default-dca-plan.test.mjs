import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultDcaPlan } from '../../server/ensureDefaultDcaPlan.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultDcaPlan', () => {
  it('seeds a plan row with today as start_date and a default investment amount', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultDcaPlan(client, userId);

    const { rows } = await client.query(
      "SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, total_investment_egp FROM dca_plan WHERE user_id = $1",
      [userId]
    );
    expect(rows).toHaveLength(1);
    const { rows: todayRows } = await client.query("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today");
    expect(rows[0].start_date).toBe(todayRows[0].today);
    expect(Number(rows[0].total_investment_egp)).toBe(300000);
  });

  it('is idempotent — running twice does not duplicate or overwrite the row', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultDcaPlan(client, userId);
    await client.query("UPDATE dca_plan SET total_investment_egp = 500000 WHERE user_id = $1", [userId]);
    await ensureDefaultDcaPlan(client, userId);

    const { rows } = await client.query('SELECT total_investment_egp FROM dca_plan WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total_investment_egp)).toBe(500000);
  });
});
