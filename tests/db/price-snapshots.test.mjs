import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('price_snapshots table', () => {
  it('has the expected columns', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'price_snapshots'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'fetched_at',
      'xau_usd',
      'usd_egp',
      'gram_24k_egp',
      'gram_22k_egp',
      'gram_21k_egp',
      'gram_18k_egp',
      'gold_pound_egp',
      'souq_dollar_egp',
      'souq_spread_pct',
      'calibration_premium_pct',
      'created_at',
    ]);

    const nullable = Object.fromEntries(
      columns.map((c) => [c.column_name, c.is_nullable])
    );
    expect(nullable.xau_usd).toBe('NO');
    expect(nullable.souq_dollar_egp).toBe('YES');
  });

  it('inserts a full snapshot row', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(`
      INSERT INTO price_snapshots
        (fetched_at, xau_usd, usd_egp, gram_24k_egp, gram_22k_egp, gram_21k_egp, gram_18k_egp, gold_pound_egp)
      VALUES (now(), 2400.5000, 47.8000, 3700.1200, 3391.7700, 3237.6000, 2775.0900, 25939.0000)
      RETURNING id
    `);

    expect(rows).toHaveLength(1);
  });

  it('has an index on fetched_at', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'price_snapshots' AND indexname = 'idx_price_snapshots_fetched_at'
    `);

    expect(rows).toHaveLength(1);
  });
});
