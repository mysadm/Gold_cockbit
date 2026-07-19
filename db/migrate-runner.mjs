import { readdir, readFile } from 'node:fs/promises';
import { getClient } from './connection.mjs';

export async function runMigrations(connectionString, migrationsDir) {
  const client = getClient(connectionString);
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const allFiles = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.filename));

    const pending = allFiles.filter((name) => !alreadyApplied.has(name));

    for (const filename of pending) {
      const sql = await readFile(new URL(filename, migrationsDir), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${err.message}`);
      }
    }

    return pending;
  } finally {
    await client.end();
  }
}
