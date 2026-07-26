import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultScenarios', () => {
  it('seeds exactly 3 scenarios for a fresh user', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultScenarios(client, userId);

    const { rows } = await client.query(
      'SELECT name, band_low, band_high, weight_pct, sort_order FROM scenarios WHERE user_id = $1 ORDER BY sort_order',
      [userId]
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(['De-escalation', 'Base Case', 'Stagflation Trap']);
    expect(rows.map((r) => Number(r.weight_pct))).toEqual([35, 45, 20]);
  });

  it('is idempotent — running twice does not duplicate rows', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultScenarios(client, userId);
    await ensureDefaultScenarios(client, userId);

    const { rows } = await client.query('SELECT id FROM scenarios WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(3);
  });
});
