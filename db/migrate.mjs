import 'dotenv/config';
import { runMigrations } from './migrate-runner.mjs';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

const applied = await runMigrations(process.env.DATABASE_URL, MIGRATIONS_DIR);

if (applied.length === 0) {
  console.log('No pending migrations.');
} else {
  console.log(`Applied ${applied.length} migration(s):`);
  applied.forEach((name) => console.log(`  - ${name}`));
}
