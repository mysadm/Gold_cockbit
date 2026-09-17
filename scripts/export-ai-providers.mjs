#!/usr/bin/env node
// Exports this app's saved AI provider connections (llm_providers rows) to a
// JSON file shaped like LlmProviderInput[], so another implementation can
// re-import them (e.g. POST each entry to its own /api/llm-providers, or
// insert them directly).
//
// By default API keys are left out — pass --with-keys to include them in
// plaintext (see the warning that prints when you do).
//
// Usage: node scripts/export-ai-providers.mjs [output-file] [--with-keys]
// Requires DATABASE_URL to be set (same as the server).

import { writeFile } from 'node:fs/promises';
import { getPool } from '../server/pool.mjs';
import { ensureDefaultUser } from '../server/ensureDefaultUser.mjs';

const args = process.argv.slice(2);
const withKeys = args.includes('--with-keys');
const outputPath = args.find((a) => !a.startsWith('--')) || 'ai-providers-export.json';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const pool = getPool(process.env.DATABASE_URL);

try {
  const userId = await ensureDefaultUser(pool);
  const columns = withKeys
    ? 'provider_type, label, base_url, api_key, model, settings, is_active'
    : 'provider_type, label, base_url, model, settings, is_active';
  const { rows } = await pool.query(
    `SELECT ${columns}
     FROM llm_providers
     WHERE user_id = $1
     ORDER BY created_at`,
    [userId]
  );

  const exported = rows.map((row) => ({
    provider_type: row.provider_type,
    label: row.label,
    base_url: row.base_url,
    ...(withKeys ? { api_key: row.api_key } : {}),
    model: row.model,
    settings: row.settings ?? {},
    is_active: row.is_active,
  }));

  await writeFile(outputPath, JSON.stringify(exported, null, 2) + '\n', 'utf8');
  console.log(`Exported ${exported.length} provider(s) to ${outputPath}${withKeys ? '' : ' (no API keys included)'}.`);
  if (withKeys) {
    console.warn(
      `WARNING: ${outputPath} contains plaintext API keys. Treat it like a credentials file — ` +
        'do not commit it, send it over an unencrypted channel, or leave it lying around. Delete it once imported.'
    );
  }
} finally {
  await pool.end();
}
