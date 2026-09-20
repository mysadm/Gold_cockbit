import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import {
  SESSION_COOKIE, parseCookies, sessionCookie, clearedSessionCookie,
  createSession, findActiveUserBySession, deleteSession, deleteSessionsForUser, deleteExpiredSessions,
} from '../../server/auth/sessions.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
let user;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  user = await createTestUser(client, { email: 'u@x.com' });
});
afterEach(async () => { await client.end(); });

describe('cookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; gc_session=abc%3D; b=2')).toEqual({ a: '1', gc_session: 'abc=', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('builds an HttpOnly SameSite=Lax cookie, Secure only when asked', () => {
    const plain = sessionCookie('tok', { secure: false });
    expect(plain).toContain(`${SESSION_COOKIE}=tok`);
    expect(plain).toContain('HttpOnly');
    expect(plain).toContain('SameSite=Lax');
    expect(plain).toContain('Path=/');
    expect(plain).toContain('Max-Age=2592000');
    expect(plain).not.toContain('Secure');
    expect(sessionCookie('tok', { secure: true })).toContain('Secure');
    expect(clearedSessionCookie({ secure: false })).toContain('Max-Age=0');
  });
});

describe('sessions', () => {
  it('finds the user for a live token and never stores the raw token', async () => {
    const token = await createSession(client, user.id);
    const found = await findActiveUserBySession(client, token);
    expect(found).toMatchObject({ id: user.id, email: 'u@x.com', role: 'user', status: 'active' });
    const { rows } = await client.query('SELECT token_hash FROM sessions');
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toHaveLength(64);
    expect(rows[0].token_hash).toBe(createHash('sha256').update(token).digest('hex'));
  });

  it('returns null for an unknown token', async () => {
    expect(await findActiveUserBySession(client, 'nope')).toBeNull();
  });

  it('returns null once the session is expired', async () => {
    const token = await createSession(client, user.id);
    await client.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'`);
    expect(await findActiveUserBySession(client, token)).toBeNull();
  });

  it('returns null immediately when the user is disabled', async () => {
    const token = await createSession(client, user.id);
    await client.query(`UPDATE users SET status = 'disabled' WHERE id = $1`, [user.id]);
    expect(await findActiveUserBySession(client, token)).toBeNull();
  });

  it('deleteSession, deleteSessionsForUser and deleteExpiredSessions remove rows', async () => {
    const t1 = await createSession(client, user.id);
    await createSession(client, user.id);
    await deleteSession(client, t1);
    expect((await client.query('SELECT count(*)::int n FROM sessions')).rows[0].n).toBe(1);
    await deleteSessionsForUser(client, user.id);
    expect((await client.query('SELECT count(*)::int n FROM sessions')).rows[0].n).toBe(0);
    await createSession(client, user.id);
    await client.query(`UPDATE sessions SET expires_at = now() - interval '1 day'`);
    await deleteExpiredSessions(client);
    expect((await client.query('SELECT count(*)::int n FROM sessions')).rows[0].n).toBe(0);
  });
});
