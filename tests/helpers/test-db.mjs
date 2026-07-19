import { runMigrations } from '../../db/migrate-runner.mjs';
import { getClient } from '../../db/connection.mjs';

export async function resetAndMigrate(migrationsDir) {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const resetClient = getClient(testDbUrl);
  await resetClient.connect();
  await resetClient.query('DROP SCHEMA public CASCADE');
  await resetClient.query('CREATE SCHEMA public');
  await resetClient.end();

  await runMigrations(testDbUrl, migrationsDir);

  const client = getClient(testDbUrl);
  await client.connect();
  return client;
}
