import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('users table', () => {
  it('has the expected columns, defaults, and constraints', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'users'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'email',
      'display_name',
      'preferred_lang',
      'theme',
      'created_at',
      'updated_at',
    ]);

    const preferredLang = columns.find((c) => c.column_name === 'preferred_lang');
    expect(preferredLang.column_default).toBe("'en'::text");

    const theme = columns.find((c) => c.column_name === 'theme');
    expect(theme.column_default).toBe("'light'::text");
  });

  it('rejects duplicate emails', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    await client.query("INSERT INTO users (email) VALUES ('a@example.com')");

    await expect(
      client.query("INSERT INTO users (email) VALUES ('a@example.com')")
    ).rejects.toThrow(/duplicate key value/);
  });

  it('rejects an invalid preferred_lang', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    await expect(
      client.query(
        "INSERT INTO users (email, preferred_lang) VALUES ('b@example.com', 'fr')"
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('sets updated_at automatically on UPDATE via the shared trigger function', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows } = await client.query(
      "INSERT INTO users (email) VALUES ('c@example.com') RETURNING id, updated_at"
    );
    const { id, updated_at: originalUpdatedAt } = rows[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.query("UPDATE users SET display_name = 'C' WHERE id = $1", [id]);

    const { rows: after } = await client.query(
      'SELECT updated_at FROM users WHERE id = $1',
      [id]
    );
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime()
    );
  });
});
