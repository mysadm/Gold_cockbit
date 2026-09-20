import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, burnPasswordTime, MIN_PASSWORD_LENGTH } from '../../server/auth/password.mjs';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('salts: hashing the same password twice gives different strings', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
  });

  it('returns false (never throws) for missing or malformed stored values', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', undefined)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$aa$bb')).toBe(false);
  });

  it('exposes the minimum length and a timing-equalising helper', async () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    await expect(burnPasswordTime('anything')).resolves.toBeUndefined();
  });
});
