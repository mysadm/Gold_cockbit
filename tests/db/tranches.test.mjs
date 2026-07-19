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

describe('tranches table', () => {
  it('has the expected columns and default status', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'tranches'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'tranche_number',
      'plan_pct',
      'amount_egp',
      'gram_equivalent',
      'status',
      'purchased_at',
      'created_at',
      'updated_at',
    ]);

    const status = columns.find((c) => c.column_name === 'status');
    expect(status.column_default).toBe("'pending'::text");
  });

  it('rejects a tranche_number outside 1..3', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'tranche1@example.com');

    await expect(
      client.query(
        'INSERT INTO tranches (user_id, tranche_number, plan_pct) VALUES ($1, $2, $3)',
        [userId, 4, 40]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('rejects an invalid status', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'tranche2@example.com');

    await expect(
      client.query(
        "INSERT INTO tranches (user_id, tranche_number, plan_pct, status) VALUES ($1, 1, 40, 'cancelled')",
        [userId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'tranche3@example.com');

    await client.query(
      'INSERT INTO tranches (user_id, tranche_number, plan_pct) VALUES ($1, 1, 40)',
      [userId]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM tranches WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });
});
