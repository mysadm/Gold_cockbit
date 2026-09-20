#!/usr/bin/env node
// Creates the first admin, or converts the pre-multi-user "default@local" user
// (keeping all its data) into the admin.
//
// Usage: node scripts/create-admin.mjs you@example.com [--name "Display Name"]
// The password is prompted for (hidden). For non-interactive use set
// ADMIN_PASSWORD in the environment. Reads DATABASE_URL like the server does.
import 'dotenv/config';
import readline from 'node:readline';
import { getPool } from '../server/pool.mjs';
import { createAdmin } from '../server/auth/createAdmin.mjs';

const args = process.argv.slice(2);
const nameIndex = args.indexOf('--name');
const displayName = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
const email = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--name');

if (!email) {
  console.error('Usage: node scripts/create-admin.mjs you@example.com [--name "Display Name"]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question) || text === '\r\n' || text === '\n') process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const pool = getPool(process.env.DATABASE_URL);
try {
  const password = process.env.ADMIN_PASSWORD || (await promptHidden('Admin password (min 8 characters): '));
  const { converted } = await createAdmin(pool, { email, password, displayName });
  console.log(
    converted
      ? `Converted the existing default user into admin ${email}; all its data was kept.`
      : `Created admin ${email}.`
  );
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
