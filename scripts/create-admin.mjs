#!/usr/bin/env node
// Creates the first admin, or converts the pre-multi-user "default@local" user
// (keeping all its data) into the admin.
//
// Usage: node scripts/create-admin.mjs you@example.com [--name "Display Name"]
// The password is prompted for twice (hidden, must match). For non-interactive use set
// ADMIN_PASSWORD in the environment. Reads DATABASE_URL like the server does.
import 'dotenv/config';
import readline from 'node:readline';
import { getPool } from '../server/pool.mjs';
import { createAdmin } from '../server/auth/createAdmin.mjs';
import { passwordsMatch } from '../server/auth/password.mjs';

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

// Asks each question in turn on one readline interface, echoing nothing the user types.
// Rejects if input ends (Ctrl+D / closed stdin) or the user hits Ctrl+C before the last answer.
function promptHidden(questions) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const answers = [];
    let done = false;
    rl._writeToOutput = (text) => {
      if (questions.includes(text) || text === '\r\n' || text === '\n') process.stdout.write(text);
    };
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
      if (!done) reject(new Error('Cancelled: no password entered.'));
    });
    const ask = () => {
      rl.question(questions[answers.length], (answer) => {
        answers.push(answer);
        if (answers.length < questions.length) return ask();
        done = true;
        rl.close();
        resolve(answers);
      });
    };
    ask();
  });
}

const normalizedEmail = String(email).trim().toLowerCase();

const pool = getPool(process.env.DATABASE_URL);
try {
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    const [first, second] = await promptHidden(['Admin password (min 8 characters): ', 'Confirm password: ']);
    if (!passwordsMatch(first, second)) {
      throw new Error('The two passwords do not match. Nothing was changed.');
    }
    password = first;
  }
  const { converted } = await createAdmin(pool, { email, password, displayName });
  console.log(
    converted
      ? `Converted the existing default user into admin ${normalizedEmail}; all its data was kept.`
      : `Created admin ${normalizedEmail}.`
  );
} catch (err) {
  console.error(`Failed to create admin ${normalizedEmail}: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
