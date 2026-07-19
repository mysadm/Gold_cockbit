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

describe('scenarios table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'scenarios'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'name',
      'band_low',
      'band_high',
      'weight_pct',
      'probability_pct',
      'sort_order',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects a weight_pct above 100', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'scenario1@example.com');

    await expect(
      client.query(
        'INSERT INTO scenarios (user_id, name, weight_pct) VALUES ($1, $2, $3)',
        [userId, 'Bull case', 150]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('rejects a negative weight_pct', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'scenario2@example.com');

    await expect(
      client.query(
        'INSERT INTO scenarios (user_id, name, weight_pct) VALUES ($1, $2, $3)',
        [userId, 'Bear case', -5]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'scenario3@example.com');

    await client.query(
      'INSERT INTO scenarios (user_id, name, weight_pct) VALUES ($1, $2, $3)',
      [userId, 'Base case', 50]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM scenarios WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });
});
