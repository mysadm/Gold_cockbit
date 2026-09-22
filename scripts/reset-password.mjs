#!/usr/bin/env node
// Resets a user's password directly in the database, without needing to log in.
// For when nobody can sign in to use the admin "Reset password" button (a
// forgotten first-admin password, an email fixed by hand, etc.).
//
// Usage: node scripts/reset-password.mjs you@example.com
// The password is prompted for twice (hidden, must match). For non-interactive use set
// RESET_PASSWORD in the environment. Reads DATABASE_URL like the server does.
import 'dotenv/config';
import readline from 'node:readline';
import { getPool } from '../server/pool.mjs';
import { resetPasswordByEmail } from '../server/auth/resetPassword.mjs';
import { passwordsMatch } from '../server/auth/password.mjs';

const email = process.argv[2];

if (!email) {
  console.error('Usage: node scripts/reset-password.mjs you@example.com');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// Asks each question in turn on one readline interface, echoing nothing the user types.
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
  let password = process.env.RESET_PASSWORD;
  if (!password) {
    const [first, second] = await promptHidden(['New password (min 8 characters): ', 'Confirm password: ']);
    if (!passwordsMatch(first, second)) {
      throw new Error('The two passwords do not match. Nothing was changed.');
    }
    password = first;
  }
  const { role } = await resetPasswordByEmail(pool, { email, password });
  console.log(`Password reset for ${normalizedEmail} (role: ${role}).`);
} catch (err) {
  console.error(`Failed to reset password for ${normalizedEmail}: ${err.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
