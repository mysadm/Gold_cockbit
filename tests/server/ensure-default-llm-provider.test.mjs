import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultLlmProvider } from '../../server/ensureDefaultLlmProvider.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('ensureDefaultLlmProvider', () => {
  it('seeds an active local Ollama provider when none exist', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);

    await ensureDefaultLlmProvider(client, userId);

    const { rows } = await client.query('SELECT * FROM llm_providers WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_type).toBe('ollama');
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].base_url).toBe('http://localhost:11434/v1');
  });

  it('does nothing when the user already has a provider configured', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const userId = await ensureDefaultUser(client);
    await client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active) VALUES ($1, 'claude', 'My Claude', 'claude-haiku-4-5', true)`,
      [userId]
    );

    await ensureDefaultLlmProvider(client, userId);

    const { rows } = await client.query('SELECT * FROM llm_providers WHERE user_id = $1', [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].provider_type).toBe('claude');
  });
});
