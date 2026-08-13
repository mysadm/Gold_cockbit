import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultWalletHoldings } from '../../server/ensureDefaultWalletHoldings.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultWalletHoldings', () => {
  it('seeds a zeroed holdings row', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultWalletHoldings(client, userId);

    const { rows } = await client.query(
      'SELECT oz, g24, g21, g18, pounds FROM wallet_holdings WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].oz)).toBe(0);
    expect(Number(rows[0].g24)).toBe(0);
    expect(Number(rows[0].g21)).toBe(0);
    expect(Number(rows[0].g18)).toBe(0);
    expect(Number(rows[0].pounds)).toBe(0);
  });

  it('is idempotent — running twice does not duplicate or overwrite the row', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultWalletHoldings(client, userId);
    await client.query('UPDATE wallet_holdings SET g24 = 10 WHERE user_id = $1', [userId]);
    await ensureDefaultWalletHoldings(client, userId);

    const { rows } = await client.query('SELECT g24 FROM wallet_holdings WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].g24)).toBe(10);
  });
});
