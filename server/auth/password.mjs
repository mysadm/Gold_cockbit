import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 8;
// Hard caps checked before any scrypt work, so a huge input cannot be used to burn CPU.
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_EMAIL_LENGTH = 254;

// Used by the create-admin prompt to compare the two typed entries.
export function passwordsMatch(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a === b;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

let dummyHash;
// Login for an unknown email still pays one scrypt, so response time does not
// reveal whether the email exists.
export async function burnPasswordTime(password) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}
