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

describe('watchlist_items table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'watchlist_items'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'label',
      'status',
      'sort_order',
      'created_at',
      'updated_at',
    ]);
  });

  it('rejects a label longer than 40 characters', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'watch1@example.com');

    const longLabel = 'x'.repeat(41);
    await expect(
      client.query(
        'INSERT INTO watchlist_items (user_id, label, status) VALUES ($1, $2, $3)',
        [userId, longLabel, 'neutral']
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'watch2@example.com');

    await client.query(
      'INSERT INTO watchlist_items (user_id, label, status) VALUES ($1, $2, $3)',
      [userId, 'Fed rate decision', 'bullish']
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query(
      'SELECT * FROM watchlist_items WHERE user_id = $1',
      [userId]
    );
    expect(rows).toHaveLength(0);
  });

  it('updates updated_at automatically', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'watch3@example.com');

    const { rows } = await client.query(
      `INSERT INTO watchlist_items (user_id, label, status)
       VALUES ($1, 'CBE reserves', 'neutral') RETURNING id, updated_at`,
      [userId]
    );
    const { id, updated_at: original } = rows[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.query("UPDATE watchlist_items SET status = 'bearish' WHERE id = $1", [id]);

    const { rows: after } = await client.query(
      'SELECT updated_at FROM watchlist_items WHERE id = $1',
      [id]
    );
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
      new Date(original).getTime()
    );
  });
});
