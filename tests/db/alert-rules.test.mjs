import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

async function makeUser(client, email) {
  const { rows } = await client.query(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [email]
  );
  return rows[0].id;
}

describe('alert_rules table', () => {
  it('has the expected columns and defaults', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'alert_rules'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'rule_type',
      'config',
      'active',
      'created_at',
      'updated_at',
    ]);

    const active = columns.find((c) => c.column_name === 'active');
    expect(active.column_default).toBe('true');
  });

  it('stores arbitrary jsonb config per rule_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'alert1@example.com');

    const { rows } = await client.query(
      `INSERT INTO alert_rules (user_id, rule_type, config)
       VALUES ($1, 'egp_move', $2::jsonb)
       RETURNING config`,
      [userId, JSON.stringify({ threshold_pct: 1.0, direction: 'either' })]
    );

    expect(rows[0].config).toEqual({ threshold_pct: 1.0, direction: 'either' });
  });

  it('rejects an invalid rule_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'alert2@example.com');

    await expect(
      client.query(
        "INSERT INTO alert_rules (user_id, rule_type, config) VALUES ($1, 'price_spike', '{}'::jsonb)",
        [userId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'alert3@example.com');

    await client.query(
      "INSERT INTO alert_rules (user_id, rule_type, config) VALUES ($1, 'band_edge', '{}'::jsonb)",
      [userId]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM alert_rules WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });
});
