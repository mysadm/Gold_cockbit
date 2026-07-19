import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from 'pg';
import { runMigrations } from '../../db/migrate-runner.mjs';

const FIXTURES_DIR = new URL('./fixtures/', import.meta.url);
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

let client;

beforeEach(async () => {
  client = new Client({ connectionString: TEST_DB_URL });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE');
  await client.query('CREATE SCHEMA public');
});

afterEach(async () => {
  await client.end();
});

describe('runMigrations', () => {
  it('applies all pending migrations in filename order and records them', async () => {
    const applied = await runMigrations(TEST_DB_URL, FIXTURES_DIR);

    expect(applied).toEqual([
      '0001_create_scratch.sql',
      '0002_alter_scratch.sql',
    ]);

    const { rows } = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'scratch' ORDER BY ordinal_position"
    );
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'label', 'note']);
  });

  it('is idempotent — running twice applies nothing the second time', async () => {
    await runMigrations(TEST_DB_URL, FIXTURES_DIR);
    const secondRun = await runMigrations(TEST_DB_URL, FIXTURES_DIR);

    expect(secondRun).toEqual([]);
  });

  it('records applied filenames in schema_migrations', async () => {
    await runMigrations(TEST_DB_URL, FIXTURES_DIR);

    const { rows } = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY filename'
    );
    expect(rows.map((r) => r.filename)).toEqual([
      '0001_create_scratch.sql',
      '0002_alter_scratch.sql',
    ]);
  });
});
