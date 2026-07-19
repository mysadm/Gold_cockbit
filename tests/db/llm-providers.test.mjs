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

describe('llm_providers table', () => {
  it('has the expected columns and defaults', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);

    const { rows: columns } = await client.query(`
      SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name = 'llm_providers'
      ORDER BY ordinal_position
    `);

    expect(columns.map((c) => c.column_name)).toEqual([
      'id',
      'user_id',
      'provider_type',
      'label',
      'base_url',
      'api_key',
      'model',
      'is_active',
      'created_at',
      'updated_at',
    ]);

    const isActive = columns.find((c) => c.column_name === 'is_active');
    expect(isActive.column_default).toBe('false');
  });

  it('rejects an invalid provider_type', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm1@example.com');

    await expect(
      client.query(
        "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'gemini', 'x', 'm')",
        [userId]
      )
    ).rejects.toThrow(/violates check constraint/);
  });

  it('allows base_url and api_key to be null', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm2@example.com');

    const { rows } = await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'ollama', 'Local', 'llama3.1') RETURNING base_url, api_key",
      [userId]
    );

    expect(rows[0].base_url).toBeNull();
    expect(rows[0].api_key).toBeNull();
  });

  it('enforces at most one active provider per user', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm3@example.com');

    await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true)",
      [userId]
    );

    await expect(
      client.query(
        "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'openai', 'OpenAI', 'gpt-4o', true)",
        [userId]
      )
    ).rejects.toThrow(/duplicate key value/);
  });

  it('allows a second active provider once the first is deactivated', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm4@example.com');

    const { rows: firstRows } = await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'claude', 'Claude', 'claude-sonnet-4-6', true) RETURNING id",
      [userId]
    );

    await client.query('UPDATE llm_providers SET is_active = false WHERE id = $1', [firstRows[0].id]);

    await expect(
      client.query(
        "INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'openai', 'OpenAI', 'gpt-4o', true)",
        [userId]
      )
    ).resolves.toBeDefined();
  });

  it('cascade-deletes when the owning user is deleted', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm5@example.com');

    await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'ollama', 'Local', 'llama3.1')",
      [userId]
    );

    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    const { rows } = await client.query('SELECT * FROM llm_providers WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(0);
  });

  it('updates updated_at automatically', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await makeUser(client, 'llm6@example.com');

    const { rows } = await client.query(
      "INSERT INTO llm_providers (user_id, provider_type, label, model) VALUES ($1, 'ollama', 'Local', 'llama3.1') RETURNING id, updated_at",
      [userId]
    );
    const { id, updated_at: original } = rows[0];

    await new Promise((resolve) => setTimeout(resolve, 10));
    await client.query("UPDATE llm_providers SET label = 'Renamed' WHERE id = $1", [id]);

    const { rows: after } = await client.query('SELECT updated_at FROM llm_providers WHERE id = $1', [id]);
    expect(new Date(after[0].updated_at).getTime()).toBeGreaterThan(new Date(original).getTime());
  });
});
