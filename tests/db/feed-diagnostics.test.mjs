import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('feed_diagnostics table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'feed_diagnostics'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'snapshot_id',
      'feed_type',
      'source_name',
      'success',
      'latency_ms',
      'error_message',
      'attempted_at',
      'detail',
    ]);
  });

  it('allows snapshot_id to be null for a fully failed pull', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(`
      INSERT INTO feed_diagnostics (feed_type, source_name, success)
      VALUES ('gold', 'metals-api', false)
      RETURNING id, snapshot_id
    `);

    expect(rows[0].snapshot_id).toBeNull();
  });

  it('cascade-deletes when the parent snapshot is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: snapshotRows } = await client.query(`
      INSERT INTO price_snapshots
        (fetched_at, xau_usd, usd_egp, gram_24k_egp, gram_22k_egp, gram_21k_egp, gram_18k_egp, gold_pound_egp)
      VALUES (now(), 2400.5, 47.8, 3700.12, 3391.77, 3237.6, 2775.09, 25939.0)
      RETURNING id
    `);
    const snapshotId = snapshotRows[0].id;

    await client.query(
      `INSERT INTO feed_diagnostics (snapshot_id, feed_type, source_name, success)
       VALUES ($1, 'gold', 'metals-api', true)`,
      [snapshotId]
    );

    await client.query('DELETE FROM price_snapshots WHERE id = $1', [snapshotId]);

    const { rows } = await client.query(
      'SELECT * FROM feed_diagnostics WHERE snapshot_id = $1',
      [snapshotId]
    );
    expect(rows).toHaveLength(0);
  });

  it('rejects an invalid feed_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    await expect(
      client.query(
        "INSERT INTO feed_diagnostics (feed_type, source_name, success) VALUES ('crypto', 'x', true)"
      )
    ).rejects.toThrow(/violates check constraint/);
  });
});
