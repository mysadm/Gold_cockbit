# Multi-user with Admin-only Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Gold Cockpit into a multi-user app where every approved user has private data and full access to every screen, while only the admin can open Settings (AI model configuration), manage users, and pay for everyone's analyses through a per-user daily cap.

**Architecture:** Server-side sessions in Postgres with an HttpOnly cookie; `requireAuth` on every `/api/*` route except `/api/auth/*`; `requireAdmin` on `/api/llm-providers`, `/api/admin/*` and `/api/software-review`. The ten existing router factories keep their `(db, userId)` signature: a small `perUserRouter` adapter builds one router per logged-in user and delegates to it, so no router or router-test has to change. The Express app is extracted from `server/index.mjs` into `server/createApp.mjs` so the wiring is testable. The client gains an `AuthGate` (login/register/pending) around `App`, per-user browser storage, and an admin-only Users panel.

**Tech Stack:** Node ESM + Express 5 + `pg` (server), `node:crypto` `scrypt` for passwords, Vitest + supertest (tests), Preact + TypeScript + Vite (client). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-multi-user-admin-design.md` (Task 12 updates it to record four small deviations decided while planning: `perUserRouter` instead of editing handlers, the old `GOLD_COCKPIT_API_KEY` middleware left in place, quota response field renamed `capped` and cap status `429`, and `/api/software-review` restricted to the admin).

## Global Constraints

- **Never** store a raw session token: only its SHA-256 hex (`sessions.token_hash`).
- Cookie name `gc_session`; attributes `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (30 days), plus `Secure` when the request is HTTPS (`req.secure` or `X-Forwarded-Proto: https`).
- Emails are lower-cased and trimmed before every read/write. Password minimum length **8**.
- `users.status`: `pending | active | disabled`; `users.role`: `admin | user`; `users.daily_ai_limit` default **3**. Exactly one admin is created by the app (`create-admin`); the schema does not forbid more, but only the first active admin (`ORDER BY created_at`) owns the system AI providers.
- Wrong password and unknown email return the **same** 401 `Invalid email or password`.
- The admin can never disable or demote themselves. There is no user-deletion route.
- Server tests use the existing real-Postgres pattern (`resetAndMigrate` from `tests/helpers/test-db.mjs`, `TEST_DATABASE_URL`), `fileParallelism: false`.
- Client tests run in Vitest's `node` environment (no DOM): put testable logic in pure modules (`src/lib/*.ts`, `src/api/*.ts`); UI components are verified in the browser with Playwright.
- Bilingual UI: every new visible string needs an Arabic and an English value, chosen by the existing `ar` / `state.lang` convention; layout must work in RTL and at 390px width. Use existing design tokens (`var(--surface)`, `var(--border)`, `btn-primary`, `btn-outline`, `instrument-card`, `Card`, `SectionLabel`).
- Commit after every task. End commit messages with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Never `git add -A`: the working tree has unrelated modified files (`.gitignore`, `start.sh`) and untracked files; add only the paths a task names.
- After each task: `npx tsc -b` clean and `npm test` fully green.

---

## File Structure

**Create (server)**
- `migrations/0024_add_multi_user_auth.sql` — users columns + `sessions`.
- `server/auth/password.mjs` — scrypt hash/verify.
- `server/auth/sessions.mjs` — cookies, token hashing, session CRUD.
- `server/auth/middleware.mjs` — `createRequireAuth`, `requireAdmin`, `perUserRouter`.
- `server/auth/rateLimit.mjs` — small in-memory limiter.
- `server/routes/auth.mjs` — register/login/logout/me.
- `server/routes/adminUsers.mjs` — admin user management.
- `server/provisionUserDefaults.mjs` — per-user default rows.
- `server/auth/createAdmin.mjs` — core of the first-admin conversion.
- `server/createApp.mjs` — the Express app (extracted from `index.mjs`).
- `scripts/create-admin.mjs` — CLI wrapper.
- `tests/helpers/users.mjs` — `createTestUser`, `signIn`.

**Modify (server):** `server/index.mjs`, `server/routes/analyze.mjs`, `tests/server/analyze-route.test.mjs`.

**Create (client):** `src/api/auth.ts`, `src/api/adminUsers.ts`, `src/lib/userStorage.ts`, `src/ui/AuthGate.tsx`, `src/ui/LoginScreen.tsx`, `src/ui/UsersPanel.tsx`.

**Modify (client):** `src/main.tsx`, `src/App.tsx`, `src/ui/Sidebar.tsx`, `src/ui/BottomNav.tsx`, `src/api/llmProviders.ts`, `src/styles.css`, `vite.config.ts`.

**Tests (create):** `tests/server/multi-user-migration.test.mjs`, `password.test.mjs`, `sessions.test.mjs`, `auth-middleware.test.mjs`, `rate-limit.test.mjs`, `auth-routes.test.mjs`, `provision-user-defaults.test.mjs`, `create-admin.test.mjs`, `multi-user-wiring.test.mjs`, `admin-users-routes.test.mjs`; `tests/lib/auth-api.test.ts`, `tests/lib/user-storage.test.ts`.

---

## Task 1: Migration — users columns and sessions

**Files:**
- Create: `migrations/0024_add_multi_user_auth.sql`
- Test: `tests/server/multi-user-migration.test.mjs`

**Interfaces:**
- Produces: `users.password_hash TEXT NULL`, `users.role`, `users.status`, `users.daily_ai_limit`; table `sessions(id UUID PK, user_id UUID FK cascade, token_hash TEXT UNIQUE, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ)`.

- [x] **Step 1: Write the failing test**

```js
// tests/server/multi-user-migration.test.mjs
import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;

afterEach(async () => {
  await client.end();
});

describe('migration 0024 (multi-user auth)', () => {
  it('gives new users role=user, status=pending, daily_ai_limit=3 and no password', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const { rows } = await client.query(
      `INSERT INTO users (email) VALUES ('a@x.com') RETURNING role, status, daily_ai_limit, password_hash`
    );
    expect(rows[0]).toEqual({ role: 'user', status: 'pending', daily_ai_limit: 3, password_hash: null });
  });

  it('rejects an invalid role, status or negative limit', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    await expect(client.query(`INSERT INTO users (email, role) VALUES ('b@x.com', 'root')`)).rejects.toThrow();
    await expect(client.query(`INSERT INTO users (email, status) VALUES ('c@x.com', 'banned')`)).rejects.toThrow();
    await expect(client.query(`INSERT INTO users (email, daily_ai_limit) VALUES ('d@x.com', -1)`)).rejects.toThrow();
  });

  it('creates sessions with a unique token_hash that cascade-delete with the user', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const { rows } = await client.query(`INSERT INTO users (email) VALUES ('e@x.com') RETURNING id`);
    const userId = rows[0].id;
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'h1', now() + interval '1 day')`,
      [userId]
    );
    await expect(
      client.query(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'h1', now() + interval '1 day')`, [userId])
    ).rejects.toThrow();
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    const left = await client.query('SELECT count(*)::int AS n FROM sessions');
    expect(left.rows[0].n).toBe(0);
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/server/multi-user-migration.test.mjs`
Expected: FAIL (`column "role" of relation "users" does not exist`).

- [x] **Step 3: Write the migration**

```sql
-- migrations/0024_add_multi_user_auth.sql
ALTER TABLE users
    ADD COLUMN password_hash TEXT,
    ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
    ADD COLUMN daily_ai_limit INTEGER NOT NULL DEFAULT 3 CHECK (daily_ai_limit >= 0);

-- Users that exist before this migration (the single default user) keep
-- working; scripts/create-admin.mjs converts that user into the admin.
UPDATE users SET status = 'active';

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
```

- [x] **Step 4: Run the test, then the whole server suite**

Run: `npx vitest run tests/server/multi-user-migration.test.mjs && npx vitest run tests/server`
Expected: PASS everywhere (existing tests use `ensureDefaultUser`, which inserts with the column defaults; nothing reads `status` yet).

- [x] **Step 5: Commit**

```bash
git add migrations/0024_add_multi_user_auth.sql tests/server/multi-user-migration.test.mjs
git commit -m "feat: add multi-user columns to users and a sessions table"
```

---

## Task 2: Password hashing

**Files:**
- Create: `server/auth/password.mjs`
- Test: `tests/server/password.test.mjs`

**Interfaces:**
- Produces: `hashPassword(password: string): Promise<string>` → `"scrypt$<saltHex>$<hashHex>"`; `verifyPassword(password: string, stored: unknown): Promise<boolean>` (false for malformed/null `stored`); `burnPasswordTime(password: string): Promise<void>` (a dummy verify used to equalise timing for unknown emails); `MIN_PASSWORD_LENGTH = 8`.

- [x] **Step 1: Write the failing test**

```js
// tests/server/password.test.mjs
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
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/server/password.test.mjs` → FAIL (module not found).

- [x] **Step 3: Implement**

```js
// server/auth/password.mjs
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 8;

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
```

- [x] **Step 4: Run** — `npx vitest run tests/server/password.test.mjs` → PASS.
- [x] **Step 5: Commit**

```bash
git add server/auth/password.mjs tests/server/password.test.mjs
git commit -m "feat: add scrypt password hashing"
```

---

## Task 3: Sessions, cookies and access-control middleware

**Files:**
- Create: `server/auth/sessions.mjs`, `server/auth/middleware.mjs`, `tests/helpers/users.mjs`
- Test: `tests/server/sessions.test.mjs`, `tests/server/auth-middleware.test.mjs`

**Interfaces:**
- Produces (`sessions.mjs`): `SESSION_COOKIE = 'gc_session'`; `parseCookies(header?: string): Record<string,string>`; `sessionCookie(token: string, { secure: boolean }): string`; `clearedSessionCookie({ secure }): string`; `isSecureRequest(req): boolean`; `createSession(db, userId): Promise<string>` (returns the raw token); `findActiveUserBySession(db, token): Promise<{id,email,display_name,role,status,daily_ai_limit}|null>`; `deleteSession(db, token)`; `deleteSessionsForUser(db, userId)`; `deleteExpiredSessions(db)`.
- Produces (`middleware.mjs`): `createRequireAuth(db)` → Express middleware setting `req.user` and `req.sessionToken` or replying 401 `{error:'Not signed in'}`; `requireAdmin` → 403 `{error:'Admin only'}`; `perUserRouter(factory: (userId) => RequestHandler): RequestHandler` (one cached router per `req.user.id`).
- Produces (`tests/helpers/users.mjs`): `createTestUser(db, { email, password='password123', role='user', status='active', displayName=null, dailyAiLimit? }) → {id,email,password}`; `signIn(app, {email,password}) → supertest agent` holding the session cookie (uses `POST /api/auth/login`, so it only works once Task 4's router is mounted).

- [x] **Step 1: Write the failing tests**

```js
// tests/server/sessions.test.mjs
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
```

```js
// tests/server/auth-middleware.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { createSession, SESSION_COOKIE } from '../../server/auth/sessions.mjs';
import { createRequireAuth, requireAdmin, perUserRouter } from '../../server/auth/middleware.mjs';
import { Router } from 'express';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
let app;
let factory;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  factory = vi.fn((userId) => {
    const r = Router();
    r.get('/whoami', (req, res) => res.json({ userId }));
    return r;
  });
  app = express();
  app.use(express.json());
  const requireAuth = createRequireAuth(client);
  app.get('/private', requireAuth, (req, res) => res.json({ id: req.user.id }));
  app.get('/admin', requireAuth, requireAdmin, (req, res) => res.json({ ok: true }));
  app.use('/per-user', requireAuth, perUserRouter(factory));
});
afterEach(async () => { await client.end(); });

const cookieFor = (token) => `${SESSION_COOKIE}=${token}`;

describe('requireAuth / requireAdmin', () => {
  it('401s without a session and with a garbage cookie', async () => {
    expect((await request(app).get('/private')).status).toBe(401);
    expect((await request(app).get('/private').set('Cookie', cookieFor('garbage'))).status).toBe(401);
  });

  it('lets an active user through and exposes req.user', async () => {
    const u = await createTestUser(client, { email: 'a@x.com' });
    const token = await createSession(client, u.id);
    const res = await request(app).get('/private').set('Cookie', cookieFor(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(u.id);
  });

  it('401s a pending user even with a valid session row', async () => {
    const u = await createTestUser(client, { email: 'p@x.com', status: 'pending' });
    const token = await createSession(client, u.id);
    expect((await request(app).get('/private').set('Cookie', cookieFor(token))).status).toBe(401);
  });

  it('requireAdmin: 403 for a user, 200 for an admin', async () => {
    const u = await createTestUser(client, { email: 'u@x.com' });
    const a = await createTestUser(client, { email: 'adm@x.com', role: 'admin' });
    const ut = await createSession(client, u.id);
    const at = await createSession(client, a.id);
    expect((await request(app).get('/admin').set('Cookie', cookieFor(ut))).status).toBe(403);
    expect((await request(app).get('/admin').set('Cookie', cookieFor(at))).status).toBe(200);
  });
});

describe('perUserRouter', () => {
  it('builds one router per user, reuses it, and routes each user to their own', async () => {
    const a = await createTestUser(client, { email: 'a@x.com' });
    const b = await createTestUser(client, { email: 'b@x.com' });
    const at = await createSession(client, a.id);
    const bt = await createSession(client, b.id);

    const r1 = await request(app).get('/per-user/whoami').set('Cookie', cookieFor(at));
    const r2 = await request(app).get('/per-user/whoami').set('Cookie', cookieFor(bt));
    const r3 = await request(app).get('/per-user/whoami').set('Cookie', cookieFor(at));

    expect(r1.body.userId).toBe(a.id);
    expect(r2.body.userId).toBe(b.id);
    expect(r3.body.userId).toBe(a.id);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/server/sessions.test.mjs tests/server/auth-middleware.test.mjs` → FAIL (modules not found).

- [x] **Step 3: Implement the test helper**

```js
// tests/helpers/users.mjs
import request from 'supertest';
import { hashPassword } from '../../server/auth/password.mjs';

export async function createTestUser(
  db,
  { email, password = 'password123', role = 'user', status = 'active', displayName = null, dailyAiLimit } = {}
) {
  const hash = await hashPassword(password);
  const withLimit = dailyAiLimit !== undefined;
  const { rows } = await db.query(
    `INSERT INTO users (email, password_hash, role, status, display_name${withLimit ? ', daily_ai_limit' : ''})
     VALUES ($1, $2, $3, $4, $5${withLimit ? ', $6' : ''}) RETURNING id`,
    withLimit ? [email, hash, role, status, displayName, dailyAiLimit] : [email, hash, role, status, displayName]
  );
  return { id: rows[0].id, email, password };
}

export async function signIn(app, { email, password }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
```

- [x] **Step 4: Implement sessions**

```js
// server/auth/sessions.mjs
import { randomBytes, createHash } from 'node:crypto';

export const SESSION_COOKIE = 'gc_session';
export const SESSION_TTL_DAYS = 30;
const MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[name] = part.slice(index + 1).trim();
    }
  }
  return out;
}

function cookie(value, maxAge, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export const sessionCookie = (token, { secure }) => cookie(token, MAX_AGE_SECONDS, secure);
export const clearedSessionCookie = ({ secure }) => cookie('', 0, secure);

export function isSecureRequest(req) {
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, hashToken(token), SESSION_TTL_DAYS]
  );
  return token;
}

export async function findActiveUserBySession(db, token) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.daily_ai_limit
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`,
    [hashToken(token)]
  );
  return rows[0] ?? null;
}

export async function deleteSession(db, token) {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function deleteSessionsForUser(db, userId) {
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

export async function deleteExpiredSessions(db) {
  await db.query('DELETE FROM sessions WHERE expires_at <= now()');
}
```

- [x] **Step 5: Implement the middleware**

```js
// server/auth/middleware.mjs
import { SESSION_COOKIE, parseCookies, findActiveUserBySession } from './sessions.mjs';

export function createRequireAuth(db) {
  return async function requireAuth(req, res, next) {
    try {
      const token = parseCookies(req.get('cookie'))[SESSION_COOKIE];
      const user = token ? await findActiveUserBySession(db, token) : null;
      if (!user) return res.status(401).json({ error: 'Not signed in' });
      req.user = user;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// The router factories take a fixed (db, userId); this builds one per logged-in
// user on first use and delegates, so no router needs to know about sessions.
export function perUserRouter(factory) {
  const cache = new Map();
  return function perUser(req, res, next) {
    let router = cache.get(req.user.id);
    if (!router) {
      router = factory(req.user.id);
      cache.set(req.user.id, router);
    }
    router(req, res, next);
  };
}
```

- [x] **Step 6: Run** — `npx vitest run tests/server/sessions.test.mjs tests/server/auth-middleware.test.mjs` → PASS.
- [x] **Step 7: Commit**

```bash
git add server/auth/sessions.mjs server/auth/middleware.mjs tests/helpers/users.mjs tests/server/sessions.test.mjs tests/server/auth-middleware.test.mjs
git commit -m "feat: add session storage, cookies and auth middleware"
```

---

## Task 4: Rate limiter and auth routes

**Files:**
- Create: `server/auth/rateLimit.mjs`, `server/routes/auth.mjs`
- Test: `tests/server/rate-limit.test.mjs`, `tests/server/auth-routes.test.mjs`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `burnPasswordTime`, `MIN_PASSWORD_LENGTH`; `createSession`, `deleteSession`, `deleteExpiredSessions`, `sessionCookie`, `clearedSessionCookie`, `isSecureRequest`, `createRequireAuth`.
- Produces: `createRateLimiter({ max, windowMs, now? }) → middleware` (429 `{error:'Too many attempts, try again later'}` + `Retry-After`); `createAuthRouter(db, { requireAuth, rateLimit }) → Router` with `POST /register`, `POST /login`, `POST /logout`, `GET /me`. The `me` shape is `{ id, email, display_name, role, daily_ai_limit, ai_used_today }`; register returns `201 { status: 'pending' }`; login errors carry `code: 'pending' | 'disabled'` for the two 403 cases.

- [x] **Step 1: Write the failing tests**

```js
// tests/server/rate-limit.test.mjs
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../../server/auth/rateLimit.mjs';

describe('createRateLimiter', () => {
  it('allows up to max requests per window, then 429s with Retry-After', async () => {
    let t = 1_000;
    const app = express();
    app.use(createRateLimiter({ max: 2, windowMs: 60_000, now: () => t }));
    app.get('/', (req, res) => res.json({ ok: true }));
    expect((await request(app).get('/')).status).toBe(200);
    expect((await request(app).get('/')).status).toBe(200);
    const blocked = await request(app).get('/');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    t += 61_000;
    expect((await request(app).get('/')).status).toBe(200);
  });
});
```

```js
// tests/server/auth-routes.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { createRequireAuth } from '../../server/auth/middleware.mjs';
import { createRateLimiter } from '../../server/auth/rateLimit.mjs';
import { createAuthRouter } from '../../server/routes/auth.mjs';
import { SESSION_COOKIE } from '../../server/auth/sessions.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
let app;

function buildApp(limit = 1000) {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', createAuthRouter(client, {
    requireAuth: createRequireAuth(client),
    rateLimit: createRateLimiter({ max: limit, windowMs: 60_000 }),
  }));
  return a;
}

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  app = buildApp();
});
afterEach(async () => { await client.end(); });

describe('POST /api/auth/register', () => {
  it('creates a pending user, lower-cases the email, and does not sign in', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: '  New@Example.COM ', password: 'longenough1', display_name: 'New Person' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'pending' });
    expect(res.headers['set-cookie']).toBeUndefined();
    const { rows } = await client.query(`SELECT email, status, role, display_name, password_hash FROM users WHERE email = 'new@example.com'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', role: 'user', display_name: 'New Person' });
    expect(rows[0].password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('validates email and password length', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'nope', password: 'longenough1' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ email: 'a@b.co', password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({})).status).toBe(400);
  });

  it('409s on a duplicate email regardless of case', async () => {
    await createTestUser(client, { email: 'dup@x.com' });
    const res = await request(app).post('/api/auth/register').send({ email: 'DUP@x.com', password: 'longenough1' });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('signs in an active user and sets an HttpOnly cookie', async () => {
    await createTestUser(client, { email: 'a@x.com', password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email: 'A@x.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'a@x.com', role: 'user', daily_ai_limit: 3, ai_used_today: 0 });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    await createTestUser(client, { email: 'a@x.com', password: 'password123' });
    const wrong = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'nope-nope-nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'password123' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('403s a pending and a disabled user with a code, only after the password checks out', async () => {
    await createTestUser(client, { email: 'p@x.com', status: 'pending' });
    await createTestUser(client, { email: 'd@x.com', status: 'disabled' });
    const pending = await request(app).post('/api/auth/login').send({ email: 'p@x.com', password: 'password123' });
    const disabled = await request(app).post('/api/auth/login').send({ email: 'd@x.com', password: 'password123' });
    expect(pending.status).toBe(403);
    expect(pending.body.code).toBe('pending');
    expect(disabled.status).toBe(403);
    expect(disabled.body.code).toBe('disabled');
    const wrongPw = await request(app).post('/api/auth/login').send({ email: 'p@x.com', password: 'wrong-wrong' });
    expect(wrongPw.status).toBe(401);
  });

  it('is rate limited', async () => {
    const limited = buildApp(2);
    await request(limited).post('/api/auth/login').send({ email: 'a@x.com', password: 'x' });
    await request(limited).post('/api/auth/login').send({ email: 'a@x.com', password: 'x' });
    expect((await request(limited).post('/api/auth/login').send({ email: 'a@x.com', password: 'x' })).status).toBe(429);
  });
});

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('401s when signed out; returns the user (with usage) when signed in; logout ends the session', async () => {
    const u = await createTestUser(client, { email: 'a@x.com', dailyAiLimit: 5 });
    await client.query(`INSERT INTO ai_shared_usage (user_id, used_on, call_count) VALUES ($1, CURRENT_DATE, 2)`, [u.id]);
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'a@x.com', password: 'password123' });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: u.id, email: 'a@x.com', daily_ai_limit: 5, ai_used_today: 2 });

    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });
});
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/server/rate-limit.test.mjs tests/server/auth-routes.test.mjs` → FAIL (modules not found).

- [x] **Step 3: Implement the limiter**

```js
// server/auth/rateLimit.mjs
export function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const t = now();
    const key = req.ip || 'unknown';
    const recent = (hits.get(key) || []).filter((ts) => ts > t - windowMs);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil((recent[0] + windowMs - t) / 1000)));
      return res.status(429).json({ error: 'Too many attempts, try again later' });
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, list] of hits) if (list.every((ts) => ts <= t - windowMs)) hits.delete(k);
    }
    next();
  };
}
```

- [x] **Step 4: Implement the auth router**

```js
// server/routes/auth.mjs
import { Router } from 'express';
import { hashPassword, verifyPassword, burnPasswordTime, MIN_PASSWORD_LENGTH } from '../auth/password.mjs';
import {
  createSession, deleteSession, deleteExpiredSessions,
  sessionCookie, clearedSessionCookie, isSecureRequest,
} from '../auth/sessions.mjs';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export async function loadMe(db, userId) {
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name, u.role, u.daily_ai_limit,
            COALESCE(a.call_count, 0)::int AS ai_used_today
       FROM users u
       LEFT JOIN ai_shared_usage a ON a.user_id = u.id AND a.used_on = CURRENT_DATE
      WHERE u.id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export function createAuthRouter(db, { requireAuth, rateLimit }) {
  const router = Router();

  router.post('/register', rateLimit, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = req.body?.password;
    const displayName = typeof req.body?.display_name === 'string' ? req.body.display_name.trim().slice(0, 80) : '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    try {
      await db.query(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3)`,
        [email, await hashPassword(password), displayName || null]
      );
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
      throw err;
    }
    res.status(201).json({ status: 'pending' });
  });

  router.post('/login', rateLimit, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const { rows } = await db.query('SELECT id, password_hash, status FROM users WHERE email = $1', [email]);
    const user = rows[0];
    if (!user) {
      await burnPasswordTime(password);
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is waiting for admin approval', code: 'pending' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'This account is disabled', code: 'disabled' });
    }
    await deleteExpiredSessions(db);
    const token = await createSession(db, user.id);
    res.set('Set-Cookie', sessionCookie(token, { secure: isSecureRequest(req) }));
    res.json(await loadMe(db, user.id));
  });

  router.post('/logout', requireAuth, async (req, res) => {
    await deleteSession(db, req.sessionToken);
    res.set('Set-Cookie', clearedSessionCookie({ secure: isSecureRequest(req) }));
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, async (req, res) => {
    res.json(await loadMe(db, req.user.id));
  });

  return router;
}
```

- [x] **Step 5: Run** — `npx vitest run tests/server/rate-limit.test.mjs tests/server/auth-routes.test.mjs` → PASS.
- [x] **Step 6: Commit**

```bash
git add server/auth/rateLimit.mjs server/routes/auth.mjs tests/server/rate-limit.test.mjs tests/server/auth-routes.test.mjs
git commit -m "feat: add register, login, logout and me endpoints with rate limiting"
```

---

## Task 5: Per-user defaults and the first-admin script

**Files:**
- Create: `server/provisionUserDefaults.mjs`, `server/auth/createAdmin.mjs`, `scripts/create-admin.mjs`
- Test: `tests/server/provision-user-defaults.test.mjs`, `tests/server/create-admin.test.mjs`

**Interfaces:**
- Consumes: existing `ensureDefaultScenarios/Tranches/DcaPlan/WalletHoldings(db, userId)`, `ensureDefaultLlmProvider(db, userId)`, `ensureDefaultUser(db)`, `hashPassword`.
- Produces: `provisionUserDefaults(db, userId): Promise<void>` (idempotent); `createAdmin(db, { email, password, displayName? }): Promise<{ id: string, converted: boolean }>` — throws `Error('An admin already exists (<email>)')` if any admin exists; throws on password shorter than 8; converts the `default@local` user if present (keeping its data), otherwise creates a fresh admin with defaults and a default Ollama provider.

- [x] **Step 1: Write the failing tests**

```js
// tests/server/provision-user-defaults.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
beforeEach(async () => { client = await resetAndMigrate(MIGRATIONS_DIR); });
afterEach(async () => { await client.end(); });

const count = async (table, userId) =>
  (await client.query(`SELECT count(*)::int n FROM ${table} WHERE user_id = $1`, [userId])).rows[0].n;

describe('provisionUserDefaults', () => {
  it('gives a new user scenarios, tranches, a DCA plan and wallet holdings, and is idempotent', async () => {
    const u = await createTestUser(client, { email: 'n@x.com' });
    await provisionUserDefaults(client, u.id);
    await provisionUserDefaults(client, u.id);
    expect(await count('scenarios', u.id)).toBe(3);
    expect(await count('tranches', u.id)).toBe(3);
    expect(await count('dca_plan', u.id)).toBe(1);
    expect(await count('wallet_holdings', u.id)).toBeGreaterThan(0);
  });

  it('does not create an AI provider (those belong to the admin)', async () => {
    const u = await createTestUser(client, { email: 'n@x.com' });
    await provisionUserDefaults(client, u.id);
    expect(await count('llm_providers', u.id)).toBe(0);
  });
});
```

```js
// tests/server/create-admin.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser } from '../helpers/users.mjs';
import { ensureDefaultUser } from '../../server/ensureDefaultUser.mjs';
import { ensureDefaultScenarios } from '../../server/ensureDefaultScenarios.mjs';
import { createAdmin } from '../../server/auth/createAdmin.mjs';
import { verifyPassword } from '../../server/auth/password.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;
beforeEach(async () => { client = await resetAndMigrate(MIGRATIONS_DIR); });
afterEach(async () => { await client.end(); });

describe('createAdmin', () => {
  it('converts the default@local user, keeping its id and data', async () => {
    const defaultId = await ensureDefaultUser(client);
    await ensureDefaultScenarios(client, defaultId);
    await client.query(`UPDATE scenarios SET weight_pct = 61 WHERE user_id = $1 AND sort_order = 0`, [defaultId]);

    const result = await createAdmin(client, { email: ' Boss@Example.com ', password: 'a-good-password', displayName: 'Boss' });

    expect(result).toEqual({ id: defaultId, converted: true });
    const { rows } = await client.query('SELECT email, role, status, display_name, password_hash FROM users WHERE id = $1', [defaultId]);
    expect(rows[0]).toMatchObject({ email: 'boss@example.com', role: 'admin', status: 'active', display_name: 'Boss' });
    expect(await verifyPassword('a-good-password', rows[0].password_hash)).toBe(true);
    const w = await client.query('SELECT weight_pct FROM scenarios WHERE user_id = $1 AND sort_order = 0', [defaultId]);
    expect(Number(w.rows[0].weight_pct)).toBe(61);
  });

  it('creates a fresh admin with defaults and a default AI provider on an empty database', async () => {
    const result = await createAdmin(client, { email: 'boss@example.com', password: 'a-good-password' });
    expect(result.converted).toBe(false);
    const { rows } = await client.query('SELECT role, status FROM users WHERE id = $1', [result.id]);
    expect(rows[0]).toEqual({ role: 'admin', status: 'active' });
    expect((await client.query('SELECT count(*)::int n FROM scenarios WHERE user_id = $1', [result.id])).rows[0].n).toBe(3);
    expect((await client.query('SELECT count(*)::int n FROM llm_providers WHERE user_id = $1', [result.id])).rows[0].n).toBe(1);
  });

  it('refuses when an admin already exists, and on a short password', async () => {
    await createTestUser(client, { email: 'first@x.com', role: 'admin' });
    await expect(createAdmin(client, { email: 'second@x.com', password: 'a-good-password' }))
      .rejects.toThrow(/admin already exists/i);
    await client.query('DELETE FROM users');
    await expect(createAdmin(client, { email: 'x@x.com', password: 'short' })).rejects.toThrow(/at least 8/);
  });
});
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/server/provision-user-defaults.test.mjs tests/server/create-admin.test.mjs` → FAIL (modules not found).

- [x] **Step 3: Implement provisioning**

```js
// server/provisionUserDefaults.mjs
import { ensureDefaultScenarios } from './ensureDefaultScenarios.mjs';
import { ensureDefaultTranches } from './ensureDefaultTranches.mjs';
import { ensureDefaultDcaPlan } from './ensureDefaultDcaPlan.mjs';
import { ensureDefaultWalletHoldings } from './ensureDefaultWalletHoldings.mjs';

export async function provisionUserDefaults(db, userId) {
  await ensureDefaultScenarios(db, userId);
  await ensureDefaultTranches(db, userId);
  await ensureDefaultDcaPlan(db, userId);
  await ensureDefaultWalletHoldings(db, userId);
}
```

- [x] **Step 4: Implement `createAdmin`**

```js
// server/auth/createAdmin.mjs
import { hashPassword, MIN_PASSWORD_LENGTH } from './password.mjs';
import { provisionUserDefaults } from '../provisionUserDefaults.mjs';
import { ensureDefaultLlmProvider } from '../ensureDefaultLlmProvider.mjs';

export async function createAdmin(db, { email, password, displayName }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new Error('A valid email is required');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const existing = await db.query(`SELECT email FROM users WHERE role = 'admin' LIMIT 1`);
  if (existing.rows.length > 0) throw new Error(`An admin already exists (${existing.rows[0].email})`);

  const passwordHash = await hashPassword(password);
  const legacy = await db.query(`SELECT id FROM users WHERE email = 'default@local'`);

  let id;
  let converted;
  if (legacy.rows.length > 0) {
    id = legacy.rows[0].id;
    converted = true;
    await db.query(
      `UPDATE users SET email = $1, password_hash = $2, role = 'admin', status = 'active',
              display_name = COALESCE($3, display_name)
        WHERE id = $4`,
      [normalized, passwordHash, displayName || null, id]
    );
  } else {
    converted = false;
    const { rows } = await db.query(
      `INSERT INTO users (email, password_hash, role, status, display_name)
       VALUES ($1, $2, 'admin', 'active', $3) RETURNING id`,
      [normalized, passwordHash, displayName || null]
    );
    id = rows[0].id;
  }
  await provisionUserDefaults(db, id);
  await ensureDefaultLlmProvider(db, id);
  return { id, converted };
}
```

- [x] **Step 5: Implement the CLI**

```js
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
```

- [x] **Step 6: Run tests** — `npx vitest run tests/server/provision-user-defaults.test.mjs tests/server/create-admin.test.mjs` → PASS.
- [x] **Step 7: Try the CLI on a scratch database**

```bash
psql postgres://localhost:5432/postgres -qc 'create database gold_cockpit_admin_try'
export DATABASE_URL=postgres://localhost:5432/gold_cockpit_admin_try
npm run migrate
ADMIN_PASSWORD='try-password-1' node scripts/create-admin.mjs try@example.com --name Try
node scripts/create-admin.mjs other@example.com   # type any 8+ char password; expect: Failed: An admin already exists (try@example.com)
psql "$DATABASE_URL" -c "select email, role, status from users"
unset DATABASE_URL
psql postgres://localhost:5432/postgres -qc 'drop database gold_cockpit_admin_try'
```
Expected: `Created admin try@example.com.`, then the "already exists" failure, then one admin row.

- [x] **Step 8: Commit**

```bash
git add server/provisionUserDefaults.mjs server/auth/createAdmin.mjs scripts/create-admin.mjs tests/server/provision-user-defaults.test.mjs tests/server/create-admin.test.mjs
git commit -m "feat: add per-user defaults and the create-admin script"
```

---

## Task 6: Extract the app, mount auth, and wire access control

**Files:**
- Create: `server/createApp.mjs`
- Modify: `server/index.mjs`
- Test: `tests/server/multi-user-wiring.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2-5, plus the existing router factories.
- Produces: `createApp(db, { adminId, authRateLimit? = { max: 20, windowMs: 15*60*1000 } }): express.Express` (no `listen`). Route protection: `/api/auth/*` open; every other `/api/*` requires a session; `/api/llm-providers`, `/api/admin`, `/api/software-review` admin-only; `/api/llm-providers` operates on `adminId`; the personal routers and `/api/analyze` are per-user via `perUserRouter`. `/api/admin` is mounted here with a placeholder that Task 7 replaces (see Step 3).
- `server/index.mjs` refuses to start (exit 1, clear message) when no active admin exists.

- [x] **Step 1: Write the failing wiring test**

```js
// tests/server/multi-user-wiring.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser, signIn } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { createApp } from '../../server/createApp.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client, app, admin, alice, bob;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin' });
  alice = await createTestUser(client, { email: 'alice@x.com' });
  bob = await createTestUser(client, { email: 'bob@x.com' });
  for (const u of [admin, alice, bob]) await provisionUserDefaults(client, u.id);
  app = createApp(client, { adminId: admin.id, authRateLimit: { max: 1000, windowMs: 60_000 } });
});
afterEach(async () => { await client.end(); });

describe('authentication is required', () => {
  it.each([
    ['get', '/api/scenarios'], ['get', '/api/tranches'], ['get', '/api/watchlist'],
    ['get', '/api/alert-rules'], ['get', '/api/dca-plan'], ['get', '/api/wallet'],
    ['get', '/api/egypt-prices'], ['get', '/api/international-prices'],
    ['get', '/api/analyze/quota'], ['get', '/api/llm-providers'], ['get', '/api/admin/users'],
  ])('%s %s -> 401 when signed out', async (method, path) => {
    expect((await request(app)[method](path)).status).toBe(401);
  });

  it('keeps /api/auth/login reachable without a session', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@x.com', password: 'whatever1' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});

describe('admin-only areas', () => {
  it.each([
    ['get', '/api/llm-providers'], ['get', '/api/admin/users'], ['post', '/api/software-review/run'],
  ])('%s %s -> 403 for a regular user', async (method, path) => {
    const agent = await signIn(app, alice);
    expect((await agent[method](path).send({})).status).toBe(403);
  });

  it('lets the admin list AI providers', async () => {
    const agent = await signIn(app, admin);
    expect((await agent.get('/api/llm-providers')).status).toBe(200);
  });
});

describe('data isolation between users', () => {
  it("each user sees only their own scenarios, and edits don't leak", async () => {
    const a = await signIn(app, alice);
    const b = await signIn(app, bob);
    const aList = (await a.get('/api/scenarios')).body;
    const bList = (await b.get('/api/scenarios')).body;
    expect(aList).toHaveLength(3);
    expect(bList).toHaveLength(3);
    expect(aList.map((s) => s.id)).not.toEqual(bList.map((s) => s.id));

    const patched = await a.patch(`/api/scenarios/${aList[0].id}`).send({ weight_pct: 61 });
    expect(Number(patched.body.weight_pct)).toBe(61);
    const bAfter = (await b.get('/api/scenarios')).body;
    expect(Number(bAfter[0].weight_pct)).toBe(35);
  });

  it("a user cannot modify another user's scenario by id", async () => {
    const a = await signIn(app, alice);
    const b = await signIn(app, bob);
    const bList = (await b.get('/api/scenarios')).body;
    const res = await a.patch(`/api/scenarios/${bList[0].id}`).send({ weight_pct: 1 });
    expect(res.status).toBe(404);
  });

  it("wallet and DCA plan are per user", async () => {
    const a = await signIn(app, alice);
    const b = await signIn(app, bob);
    const aPlan = (await a.get('/api/dca-plan')).body;
    const bPlan = (await b.get('/api/dca-plan')).body;
    expect(aPlan.user_id).toBe(alice.id);
    expect(bPlan.user_id).toBe(bob.id);
  });
});
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/server/multi-user-wiring.test.mjs` → FAIL (`createApp` not found).

- [x] **Step 3: Implement `createApp`** (the admin router is added in Task 7; until then `/api/admin` is a minimal stub that returns 404 for everything but is still behind `requireAdmin`, which is what these tests need)

```js
// server/createApp.mjs
import express from 'express';
import { createRequireAuth, requireAdmin, perUserRouter } from './auth/middleware.mjs';
import { createRateLimiter } from './auth/rateLimit.mjs';
import { createAuthRouter } from './routes/auth.mjs';
import { createLlmProvidersRouter } from './routes/llmProviders.mjs';
import { createAnalyzeRouter } from './routes/analyze.mjs';
import { createEgyptPricesRouter } from './routes/egyptPrices.mjs';
import { createInternationalPricesRouter } from './routes/internationalPrices.mjs';
import { createScenariosRouter } from './routes/scenarios.mjs';
import { createTranchesRouter } from './routes/tranches.mjs';
import { createWatchlistRouter } from './routes/watchlist.mjs';
import { createAlertRulesRouter } from './routes/alertRules.mjs';
import { createDcaPlanRouter } from './routes/dcaPlan.mjs';
import { createWalletRouter } from './routes/wallet.mjs';
import { createSoftwareReviewRouter } from './routes/softwareReview.mjs';

export function createApp(db, { adminId, authRateLimit = { max: 20, windowMs: 15 * 60 * 1000 } }) {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(express.json());
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const requireAuth = createRequireAuth(db);
  app.use('/api/auth', createAuthRouter(db, { requireAuth, rateLimit: createRateLimiter(authRateLimit) }));

  app.use('/api', requireAuth);

  app.use('/api/admin', requireAdmin, createAdminPlaceholderRouter());
  app.use('/api/llm-providers', requireAdmin, createLlmProvidersRouter(db, adminId));
  app.use('/api/software-review', requireAdmin, createSoftwareReviewRouter());

  app.use('/api/analyze', perUserRouter((userId) => createAnalyzeRouter(db, userId, { providerOwnerId: adminId })));
  app.use('/api/scenarios', perUserRouter((userId) => createScenariosRouter(db, userId)));
  app.use('/api/tranches', perUserRouter((userId) => createTranchesRouter(db, userId)));
  app.use('/api/watchlist', perUserRouter((userId) => createWatchlistRouter(db, userId)));
  app.use('/api/alert-rules', perUserRouter((userId) => createAlertRulesRouter(db, userId)));
  app.use('/api/dca-plan', perUserRouter((userId) => createDcaPlanRouter(db, userId)));
  app.use('/api/wallet', perUserRouter((userId) => createWalletRouter(db, userId)));

  app.use('/api/egypt-prices', createEgyptPricesRouter(db));
  app.use('/api/international-prices', createInternationalPricesRouter(db));

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function createAdminPlaceholderRouter() {
  return express.Router();
}
```

Note: `createAnalyzeRouter(db, userId, { providerOwnerId })` gets its third argument in Task 8; until then the extra argument is ignored by JavaScript, so this task's tests (which never call `/api/analyze` successfully) pass.

- [x] **Step 4: Replace `server/index.mjs`**

```js
import 'dotenv/config';
import { getPool } from './pool.mjs';
import { createApp } from './createApp.mjs';

const PORT = process.env.SERVER_PORT || 8787;

const pool = getPool(process.env.DATABASE_URL);
const { rows } = await pool.query(
  `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`
);
if (rows.length === 0) {
  console.error('No admin account exists yet. Create one first:\n  node scripts/create-admin.mjs you@example.com');
  process.exit(1);
}

const app = createApp(pool, { adminId: rows[0].id });

app.listen(PORT, () => {
  console.log(`Gold Cockpit API server listening on http://localhost:${PORT}`);
});
```

- [x] **Step 5: Run the wiring tests, then everything** — `npx vitest run tests/server/multi-user-wiring.test.mjs && npm test`
Expected: PASS. `index-routes-smoke.test.mjs` still passes (it builds its own app and does not import `index.mjs`).

- [x] **Step 6: Commit**

```bash
git add server/createApp.mjs server/index.mjs tests/server/multi-user-wiring.test.mjs
git commit -m "feat: require login on every API route and gate admin-only areas"
```

---

## Task 7: Admin user-management routes

**Files:**
- Create: `server/routes/adminUsers.mjs`
- Modify: `server/createApp.mjs`
- Test: `tests/server/admin-users-routes.test.mjs`

**Interfaces:**
- Consumes: `provisionUserDefaults`, `hashPassword`, `MIN_PASSWORD_LENGTH`, `deleteSessionsForUser`.
- Produces: `createAdminUsersRouter(db) → Router`, mounted at `/api/admin` (already behind `requireAdmin`; the router reads `req.user.id` for self-protection):
  - `GET /users` → `[{ id, email, display_name, role, status, daily_ai_limit, created_at, ai_used_today }]`, pending first then oldest first
  - `POST /users/:id/approve` (only `pending`→`active`, provisions defaults; 409 if not pending)
  - `POST /users/:id/disable` (400 on self; deletes the user's sessions), `POST /users/:id/enable` (only `disabled`→`active`; 409 otherwise)
  - `PATCH /users/:id` `{ daily_ai_limit }` (integer 0–1000, else 400)
  - `POST /users/:id/reset-password` `{ password }` (min 8; deletes the user's sessions)
  - Unknown or malformed id → 404.

- [x] **Step 1: Write the failing tests**

```js
// tests/server/admin-users-routes.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { createTestUser, signIn } from '../helpers/users.mjs';
import { provisionUserDefaults } from '../../server/provisionUserDefaults.mjs';
import { createApp } from '../../server/createApp.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client, app, admin, adminAgent, pending;

beforeEach(async () => {
  client = await resetAndMigrate(MIGRATIONS_DIR);
  admin = await createTestUser(client, { email: 'admin@x.com', role: 'admin', displayName: 'Boss' });
  await provisionUserDefaults(client, admin.id);
  pending = await createTestUser(client, { email: 'new@x.com', status: 'pending' });
  app = createApp(client, { adminId: admin.id, authRateLimit: { max: 1000, windowMs: 60_000 } });
  adminAgent = await signIn(app, admin);
});
afterEach(async () => { await client.end(); });

describe('GET /api/admin/users', () => {
  it('lists users with status and today usage, pending first', async () => {
    await client.query(`INSERT INTO ai_shared_usage (user_id, used_on, call_count) VALUES ($1, CURRENT_DATE, 2)`, [admin.id]);
    const res = await adminAgent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.email)).toEqual(['new@x.com', 'admin@x.com']);
    expect(res.body[1]).toMatchObject({ role: 'admin', status: 'active', ai_used_today: 2, daily_ai_limit: 3 });
    expect(res.body[0]).not.toHaveProperty('password_hash');
  });
});

describe('approve / disable / enable', () => {
  it('approve activates a pending user and provisions their defaults', async () => {
    const res = await adminAgent.post(`/api/admin/users/${pending.id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect((await client.query('SELECT count(*)::int n FROM scenarios WHERE user_id = $1', [pending.id])).rows[0].n).toBe(3);
    // the approved user can now sign in
    expect((await signIn(app, pending)).get).toBeDefined();
  });

  it('approve 409s on a user that is not pending', async () => {
    const res = await adminAgent.post(`/api/admin/users/${admin.id}/approve`);
    expect(res.status).toBe(409);
  });

  it('disable locks an active user out immediately; enable restores them', async () => {
    const u = await createTestUser(client, { email: 'u@x.com' });
    const agent = await signIn(app, u);
    expect((await agent.get('/api/scenarios')).status).toBe(200);
    expect((await adminAgent.post(`/api/admin/users/${u.id}/disable`)).status).toBe(200);
    expect((await agent.get('/api/scenarios')).status).toBe(401);
    expect((await adminAgent.post(`/api/admin/users/${u.id}/enable`)).status).toBe(200);
    expect((await signIn(app, u)).get).toBeDefined();
  });

  it('the admin cannot disable themselves', async () => {
    const res = await adminAgent.post(`/api/admin/users/${admin.id}/disable`);
    expect(res.status).toBe(400);
  });

  it('enable 409s on a user that is not disabled', async () => {
    const res = await adminAgent.post(`/api/admin/users/${admin.id}/enable`);
    expect(res.status).toBe(409);
  });

  it('404s for an unknown or malformed id', async () => {
    expect((await adminAgent.post('/api/admin/users/00000000-0000-0000-0000-000000000000/approve')).status).toBe(404);
    expect((await adminAgent.post('/api/admin/users/not-a-uuid/approve')).status).toBe(404);
  });
});

describe('PATCH daily limit and reset password', () => {
  it('updates daily_ai_limit and validates the range', async () => {
    const ok = await adminAgent.patch(`/api/admin/users/${pending.id}`).send({ daily_ai_limit: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body.daily_ai_limit).toBe(7);
    expect((await adminAgent.patch(`/api/admin/users/${pending.id}`).send({ daily_ai_limit: -1 })).status).toBe(400);
    expect((await adminAgent.patch(`/api/admin/users/${pending.id}`).send({ daily_ai_limit: 1.5 })).status).toBe(400);
    expect((await adminAgent.patch(`/api/admin/users/${pending.id}`).send({})).status).toBe(400);
  });

  it('reset-password sets a new password and ends the user\'s sessions', async () => {
    const u = await createTestUser(client, { email: 'u@x.com', password: 'old-password-1' });
    const agent = await signIn(app, u);
    const res = await adminAgent.post(`/api/admin/users/${u.id}/reset-password`).send({ password: 'new-password-1' });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/scenarios')).status).toBe(401);
    expect((await signIn(app, { email: 'u@x.com', password: 'new-password-1' })).get).toBeDefined();
    await expect(signIn(app, { email: 'u@x.com', password: 'old-password-1' })).rejects.toThrow();
  });

  it('reset-password rejects a short password', async () => {
    const res = await adminAgent.post(`/api/admin/users/${pending.id}/reset-password`).send({ password: 'short' });
    expect(res.status).toBe(400);
  });
});
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/server/admin-users-routes.test.mjs` → FAIL (404s: placeholder router).

- [x] **Step 3: Implement the router**

```js
// server/routes/adminUsers.mjs
import { Router } from 'express';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password.mjs';
import { deleteSessionsForUser } from '../auth/sessions.mjs';
import { provisionUserDefaults } from '../provisionUserDefaults.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PUBLIC_COLUMNS = 'id, email, display_name, role, status, daily_ai_limit, created_at';

export function createAdminUsersRouter(db) {
  const router = Router();

  router.get('/users', async (req, res) => {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.display_name, u.role, u.status, u.daily_ai_limit, u.created_at,
              COALESCE(a.call_count, 0)::int AS ai_used_today
         FROM users u
         LEFT JOIN ai_shared_usage a ON a.user_id = u.id AND a.used_on = CURRENT_DATE
        ORDER BY (u.status = 'pending') DESC, u.created_at`
    );
    res.json(rows);
  });

  router.param('id', (req, res, next, id) => {
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'User not found' });
    next();
  });

  async function transition(req, res, { from, to, before }) {
    const { rows } = await db.query('SELECT status FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (rows[0].status !== from) return res.status(409).json({ error: `User is ${rows[0].status}, not ${from}` });
    if (before) await before();
    const updated = await db.query(`UPDATE users SET status = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`, [to, req.params.id]);
    res.json(updated.rows[0]);
  }

  router.post('/users/:id/approve', (req, res) =>
    transition(req, res, { from: 'pending', to: 'active', before: () => provisionUserDefaults(db, req.params.id) })
  );

  router.post('/users/:id/enable', (req, res) => transition(req, res, { from: 'disabled', to: 'active' }));

  router.post('/users/:id/disable', async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot disable your own account' });
    const { rows } = await db.query('SELECT status FROM users WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const updated = await db.query(
      `UPDATE users SET status = 'disabled' WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
      [req.params.id]
    );
    await deleteSessionsForUser(db, req.params.id);
    res.json(updated.rows[0]);
  });

  router.patch('/users/:id', async (req, res) => {
    const limit = req.body?.daily_ai_limit;
    if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
      return res.status(400).json({ error: 'daily_ai_limit must be a whole number from 0 to 1000' });
    }
    const { rows } = await db.query(
      `UPDATE users SET daily_ai_limit = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
      [limit, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    const { rows } = await db.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
      [await hashPassword(password), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    await deleteSessionsForUser(db, req.params.id);
    res.json({ ok: true });
  });

  return router;
}
```

- [x] **Step 4: Mount it.** In `server/createApp.mjs`: add `import { createAdminUsersRouter } from './routes/adminUsers.mjs';`, change the line to `app.use('/api/admin', requireAdmin, createAdminUsersRouter(db));`, and delete the `createAdminPlaceholderRouter` function.

- [x] **Step 5: Run** — `npx vitest run tests/server/admin-users-routes.test.mjs tests/server/multi-user-wiring.test.mjs` → PASS.
- [x] **Step 6: Commit**

```bash
git add server/routes/adminUsers.mjs server/createApp.mjs tests/server/admin-users-routes.test.mjs
git commit -m "feat: add admin routes to approve, disable, limit and reset users"
```

---

## Task 8: Analysis uses the admin's provider and a per-user daily cap

**Files:**
- Modify: `server/routes/analyze.mjs`
- Modify (rewrite two `describe` blocks): `tests/server/analyze-route.test.mjs`

**Interfaces:**
- Consumes: `users.role`, `users.daily_ai_limit`, `ai_shared_usage`.
- Produces: `createAnalyzeRouter(db, userId, { providerOwnerId = userId } = {})`. `GET /quota` → `{ capped: false }` for an admin, else `{ capped: true, used, limit }`. `POST /` → `429 { error: 'Daily analysis limit reached', used, limit }` when a regular user is at their limit (checked before anything else; provider is not called). After a **successful** analysis by a regular user (or any analysis on the `shared` provider type) one use is recorded in `ai_shared_usage` (cost `0` unless the provider type is `shared`, whose Haiku-priced cost is kept). The env `SHARED_AI_DAILY_LIMIT` and the shared-tier 402 are removed. The provider looked up is the active provider of `providerOwnerId`.

- [x] **Step 1: Rewrite the two quota `describe` blocks in the test (they will fail against the current code).**
In `tests/server/analyze-route.test.mjs`, delete everything from `describe('GET /api/analyze/quota', () => {` up to (not including) `describe('POST /api/analyze — web search augmentation', () => {`, and insert:

```js
describe('GET /api/analyze/quota', () => {
  it('reports used/limit for a regular user, with 0 used before any calls', async () => {
    const res = await request(app).get('/api/analyze/quota');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ capped: true, used: 0, limit: 3 });
  });

  it("reflects a per-user limit set by the admin and today's recorded usage", async () => {
    await client.query('UPDATE users SET daily_ai_limit = 5 WHERE id = $1', [userId]);
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 2, 0)`,
      [userId]
    );
    const res = await request(app).get('/api/analyze/quota');
    expect(res.body).toEqual({ capped: true, used: 2, limit: 5 });
  });

  it('reports capped:false for an admin', async () => {
    await client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
    const res = await request(app).get('/api/analyze/quota');
    expect(res.body).toEqual({ capped: false });
  });
});

describe('POST /api/analyze — per-user daily cap', () => {
  const insertProvider = (type = 'claude', label = 'My Claude', owner = userId) =>
    client.query(
      `INSERT INTO llm_providers (user_id, provider_type, label, model, is_active)
       VALUES ($1, $2, $3, 'some-model', true)`,
      [owner, type, label]
    );
  const usageRows = () =>
    client.query('SELECT call_count, total_cost_usd FROM ai_shared_usage WHERE user_id = $1 AND used_on = CURRENT_DATE', [userId]);

  it('records one use per successful analysis for any provider type', async () => {
    await insertProvider('claude');
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    for (let i = 0; i < 2; i++) {
      expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    }
    const { rows } = await usageRows();
    expect(rows[0].call_count).toBe(2);
    expect(Number(rows[0].total_cost_usd)).toBe(0);
  });

  it('tracks Haiku-priced cost when the provider is the shared tier', async () => {
    await insertProvider('shared', 'Shared AI');
    runProviderAnalysis.mockResolvedValue({
      text: '{"one_liner":"ok"}',
      usedWebSearch: false,
      usage: { input_tokens: 2000, output_tokens: 500 },
    });
    await request(app).post('/api/analyze').send({ prompt: 'x' });
    await request(app).post('/api/analyze').send({ prompt: 'x' });
    const { rows } = await usageRows();
    expect(rows[0].call_count).toBe(2);
    // 2000 in * $1/1M + 500 out * $5/1M = 0.0045, twice = 0.009
    expect(Number(rows[0].total_cost_usd)).toBeCloseTo(0.009, 4);
  });

  it('blocks a call past the limit with 429 and never calls the provider', async () => {
    await insertProvider('claude');
    await client.query(
      `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd) VALUES ($1, CURRENT_DATE, 3, 0)`,
      [userId]
    );
    const res = await request(app).post('/api/analyze').send({ prompt: 'x' });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Daily analysis limit reached', used: 3, limit: 3 });
    expect(runProviderAnalysis).not.toHaveBeenCalled();
  });

  it("honours a per-user limit change (limit 1 blocks the second call)", async () => {
    await insertProvider('claude');
    await client.query('UPDATE users SET daily_ai_limit = 1 WHERE id = $1', [userId]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(429);
  });

  it('does not cap or record usage for an admin', async () => {
    await insertProvider('claude');
    await client.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [userId]);
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(200);
    }
    expect((await usageRows()).rows).toHaveLength(0);
  });

  it('does not consume quota when the provider call fails', async () => {
    await insertProvider('claude');
    runProviderAnalysis.mockRejectedValue(new Error('HTTP 500'));
    expect((await request(app).post('/api/analyze').send({ prompt: 'x' })).status).toBe(502);
    expect((await usageRows()).rows).toHaveLength(0);
  });

  it("uses the provider owned by providerOwnerId (the admin's), not the caller's", async () => {
    const { rows } = await client.query(
      `INSERT INTO users (email, role, status) VALUES ('admin@x.com', 'admin', 'active') RETURNING id`
    );
    const adminId = rows[0].id;
    await insertProvider('claude', 'Admin Claude', adminId);
    await insertProvider('claude', 'Caller Own', userId);
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use('/api/analyze', createAnalyzeRouter(client, userId, { providerOwnerId: adminId }));
    runProviderAnalysis.mockResolvedValue({ text: '{"one_liner":"ok"}', usedWebSearch: false });

    const res = await request(adminApp).post('/api/analyze').send({ prompt: 'x' });

    expect(res.status).toBe(200);
    expect(runProviderAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Admin Claude' }),
      expect.anything()
    );
  });
});

```

- [x] **Step 2: Run and confirm the new tests fail** — `npx vitest run tests/server/analyze-route.test.mjs` → the new `quota` and cap tests FAIL (`shared:false` returned, no 429, etc.).

- [x] **Step 3: Implement in `server/routes/analyze.mjs`.** Read the file first, then make these edits:

(a) Delete the line `const SHARED_DAILY_LIMIT = Number(process.env.SHARED_AI_DAILY_LIMIT) || 2;` and the `import { createApiKeyAuthMiddleware }` line **stays** (the router keeps its existing no-op-when-unset key check).

(b) Directly above `export function createAnalyzeRouter`, add:

```js
async function getUserCap(db, userId) {
  const { rows } = await db.query('SELECT role, daily_ai_limit FROM users WHERE id = $1', [userId]);
  const user = rows[0];
  return { capped: Boolean(user) && user.role !== 'admin', limit: user ? user.daily_ai_limit : 0 };
}

async function getUsedToday(db, userId) {
  const { rows } = await db.query(
    'SELECT call_count FROM ai_shared_usage WHERE user_id = $1 AND used_on = CURRENT_DATE',
    [userId]
  );
  return rows.length > 0 ? rows[0].call_count : 0;
}

async function recordUsage(db, userId, costUsd) {
  await db.query(
    `INSERT INTO ai_shared_usage (user_id, used_on, call_count, total_cost_usd)
     VALUES ($1, CURRENT_DATE, 1, $2)
     ON CONFLICT (user_id, used_on)
     DO UPDATE SET call_count = ai_shared_usage.call_count + 1, total_cost_usd = ai_shared_usage.total_cost_usd + $2`,
    [userId, costUsd]
  );
}
```

(c) Change the signature to `export function createAnalyzeRouter(db, userId, { providerOwnerId = userId } = {}) {`.

(d) Replace the whole `router.get('/quota', ...)` handler with:

```js
  router.get('/quota', async (req, res) => {
    const cap = await getUserCap(db, userId);
    if (!cap.capped) return res.json({ capped: false });
    res.json({ capped: true, used: await getUsedToday(db, userId), limit: cap.limit });
  });
```

(e) In `router.post('/', ...)`, insert as the very first statements of the handler (before `const { prompt, snapshot } = req.body;`):

```js
    const cap = await getUserCap(db, userId);
    if (cap.capped) {
      const used = await getUsedToday(db, userId);
      if (used >= cap.limit) {
        return res.status(429).json({ error: 'Daily analysis limit reached', used, limit: cap.limit });
      }
    }
```

(f) In the provider lookup `db.query('SELECT * FROM llm_providers WHERE user_id = $1 AND is_active = true', [userId])` change the parameter to `[providerOwnerId]`.

(g) Delete the block `if (isShared) { ... 'Insufficient credit balance' ... }` (the usage-check that returns 402), keeping `const isShared = provider.provider_type === 'shared';`.

(h) In the v3 branch replace the `if(isShared) { await db.query(...INSERT INTO ai_shared_usage...estimateSharedCostUsd(output.usage)...) }` block with:

```js
        if (cap.capped || isShared) await recordUsage(db, userId, isShared ? estimateSharedCostUsd(output.usage) : 0);
```

(i) At the end of the v2 path replace the `if (isShared) { const cost = ...; if (cost > SHARED_COST_WARN_THRESHOLD_USD) {...} await db.query(INSERT ... ai_shared_usage ...) }` block with:

```js
      if (cap.capped || isShared) {
        const cost = isShared ? estimateSharedCostUsd(result.usage) : 0;
        if (isShared && cost > SHARED_COST_WARN_THRESHOLD_USD) {
          console.warn(
            `[shared-ai] analysis for user ${userId} cost ~$${cost.toFixed(4)}, above the $${SHARED_COST_WARN_THRESHOLD_USD} target`
          );
        }
        await recordUsage(db, userId, cost);
      }
```

- [x] **Step 4: Run** — `npx vitest run tests/server/analyze-route.test.mjs` → PASS. Then `npm test`. Any other pre-existing analyze tests that failed because the default test user is now capped at 3 calls per test must not exist (each test resets the DB); if one does, it is calling analyze more than 3 times: raise that test's user limit with `UPDATE users SET daily_ai_limit = 100 WHERE id = $1` rather than changing behaviour.
- [x] **Step 5: Commit**

```bash
git add server/routes/analyze.mjs tests/server/analyze-route.test.mjs
git commit -m "feat: run analyses on the admin's provider with a per-user daily cap"
```

---

## Task 9: Client auth plumbing (pure modules)

**Files:**
- Create: `src/api/auth.ts`, `src/api/adminUsers.ts`, `src/lib/userStorage.ts`
- Modify: `src/api/llmProviders.ts` (the `AnalyzeQuota` type), `vite.config.ts`
- Test: `tests/lib/auth-api.test.ts`, `tests/lib/user-storage.test.ts`

**Interfaces:**
- Produces (`auth.ts`): `type CurrentUser = { id: string; email: string; display_name: string | null; role: 'admin' | 'user'; daily_ai_limit: number; ai_used_today: number }`; `class AuthError extends Error { code?: 'pending' | 'disabled' }`; `fetchMe(): Promise<CurrentUser | null>` (null on 401); `login(email, password): Promise<CurrentUser>` (throws `AuthError`); `register(email, password, displayName): Promise<void>` (throws `AuthError`); `logout(): Promise<void>`; `installUnauthorizedHandler(onUnauthorized: () => void): () => void` (wraps `window.fetch`; returns an uninstall function).
- Produces (`adminUsers.ts`): `type AdminUser = { id; email; display_name: string | null; role: 'admin' | 'user'; status: 'pending' | 'active' | 'disabled'; daily_ai_limit: number; created_at: string; ai_used_today: number }`; `listUsers()`, `approveUser(id)`, `disableUser(id)`, `enableUser(id)`, `setDailyLimit(id, limit)`, `resetPassword(id, password)`; each throws `Error(message)` using the server's `error` text.
- Produces (`userStorage.ts`): `type StorageKeys = { state: string; monitors: string; level: string }`; `LEGACY_KEYS`; `storageKeysFor(userId): StorageKeys`; `migrateLegacyStorage(storage, user)`: for an **admin** whose per-user state key is empty, copies the three legacy keys to the per-user keys and removes the legacy ones; a regular user's browser is never migrated.
- Changes `AnalyzeQuota` to `{ capped: false } | { capped: true; used: number; limit: number }`.

- [x] **Step 1: Write the failing tests**

```ts
// tests/lib/user-storage.test.ts
import { describe, it, expect } from 'vitest';
import { LEGACY_KEYS, storageKeysFor, migrateLegacyStorage } from '../../src/lib/userStorage';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
  };
}

describe('storageKeysFor', () => {
  it('namespaces every key by user id', () => {
    expect(storageKeysFor('u1')).toEqual({
      state: 'gold-cockpit-state-v1:u1',
      monitors: 'ghc_monitors:u1',
      level: 'ghc_level:u1',
    });
  });
});

describe('migrateLegacyStorage', () => {
  const legacy = { [LEGACY_KEYS.state]: '{"spot":1}', [LEGACY_KEYS.monitors]: '[]', [LEGACY_KEYS.level]: 'expert' };

  it('moves legacy keys to the admin\'s per-user keys', () => {
    const s = fakeStorage(legacy);
    migrateLegacyStorage(s, { id: 'admin1', role: 'admin' });
    const keys = storageKeysFor('admin1');
    expect(s.data[keys.state]).toBe('{"spot":1}');
    expect(s.data[keys.monitors]).toBe('[]');
    expect(s.data[keys.level]).toBe('expert');
    expect(s.data[LEGACY_KEYS.state]).toBeUndefined();
  });

  it('never migrates for a regular user, and leaves legacy data alone', () => {
    const s = fakeStorage(legacy);
    migrateLegacyStorage(s, { id: 'u2', role: 'user' });
    expect(s.data[storageKeysFor('u2').state]).toBeUndefined();
    expect(s.data[LEGACY_KEYS.state]).toBe('{"spot":1}');
  });

  it('does not overwrite an existing per-user state', () => {
    const keys = storageKeysFor('admin1');
    const s = fakeStorage({ ...legacy, [keys.state]: '{"spot":9}' });
    migrateLegacyStorage(s, { id: 'admin1', role: 'admin' });
    expect(s.data[keys.state]).toBe('{"spot":9}');
  });

  it('is a no-op when there is no legacy state', () => {
    const s = fakeStorage();
    migrateLegacyStorage(s, { id: 'admin1', role: 'admin' });
    expect(Object.keys(s.data)).toHaveLength(0);
  });
});
```

```ts
// tests/lib/auth-api.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchMe, login, register, logout, AuthError, installUnauthorizedHandler } from '../../src/api/auth';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth api', () => {
  it('fetchMe returns the user, or null on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(200, { id: 'u1', email: 'a@x.com', role: 'user' })));
    expect((await fetchMe())?.id).toBe('u1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: 'Not signed in' })));
    expect(await fetchMe()).toBeNull();
  });

  it('login posts the credentials and returns the user', async () => {
    const f = vi.fn().mockResolvedValueOnce(json(200, { id: 'u1', role: 'user' }));
    vi.stubGlobal('fetch', f);
    expect((await login('a@x.com', 'pw123456')).id).toBe('u1');
    expect(f).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('login surfaces the pending/disabled code on AuthError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(403, { error: 'waiting', code: 'pending' })));
    await expect(login('a@x.com', 'pw123456')).rejects.toMatchObject({ code: 'pending', message: 'waiting' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(401, { error: 'Invalid email or password' })));
    const err = await login('a@x.com', 'bad').catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBeUndefined();
  });

  it('register and logout call their endpoints', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(201, { status: 'pending' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    vi.stubGlobal('fetch', f);
    await register('a@x.com', 'pw123456', 'A');
    await logout();
    expect(f.mock.calls[0][0]).toBe('/api/auth/register');
    expect(f.mock.calls[1][0]).toBe('/api/auth/logout');
  });
});

describe('installUnauthorizedHandler', () => {
  it('calls the handler on a 401 from /api/*, but not for /api/auth/login', async () => {
    const original = vi.fn()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, {}));
    const fakeWindow = { fetch: original } as unknown as Window & typeof globalThis;
    vi.stubGlobal('window', fakeWindow);
    const onUnauthorized = vi.fn();
    const uninstall = installUnauthorizedHandler(onUnauthorized);

    await fakeWindow.fetch('/api/wallet');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await fakeWindow.fetch('/api/auth/login', { method: 'POST' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await fakeWindow.fetch('/api/wallet');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    uninstall();
    expect(fakeWindow.fetch).toBe(original);
  });
});
```

- [x] **Step 2: Run and confirm failure** — `npx vitest run tests/lib/auth-api.test.ts tests/lib/user-storage.test.ts` → FAIL (modules not found).

- [x] **Step 3: Implement `userStorage.ts`**

```ts
// src/lib/userStorage.ts
export type StorageKeys = { state: string; monitors: string; level: string };

export const LEGACY_KEYS: StorageKeys = {
  state: 'gold-cockpit-state-v1',
  monitors: 'ghc_monitors',
  level: 'ghc_level',
};

export function storageKeysFor(userId: string): StorageKeys {
  return {
    state: `${LEGACY_KEYS.state}:${userId}`,
    monitors: `${LEGACY_KEYS.monitors}:${userId}`,
    level: `${LEGACY_KEYS.level}:${userId}`,
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Before multi-user the browser held one unscoped state. It belongs to whoever
// used the app then: the admin. A regular user's browser is never migrated, so
// nobody inherits someone else's weights or watchlist.
export function migrateLegacyStorage(storage: StorageLike, user: { id: string; role: 'admin' | 'user' }) {
  if (user.role !== 'admin') return;
  const keys = storageKeysFor(user.id);
  if (storage.getItem(keys.state) !== null) return;
  const legacyState = storage.getItem(LEGACY_KEYS.state);
  if (legacyState === null) return;
  for (const name of ['state', 'monitors', 'level'] as const) {
    const value = storage.getItem(LEGACY_KEYS[name]);
    if (value !== null) storage.setItem(keys[name], value);
    storage.removeItem(LEGACY_KEYS[name]);
  }
}
```

- [x] **Step 4: Implement `auth.ts`**

```ts
// src/api/auth.ts
export type CurrentUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  daily_ai_limit: number;
  ai_used_today: number;
};

export class AuthError extends Error {
  code?: 'pending' | 'disabled';
  constructor(message: string, code?: 'pending' | 'disabled') {
    super(message);
    this.code = code;
  }
}

async function readJson(response: Response) {
  return response.json().catch(() => ({}));
}

export async function fetchMe(): Promise<CurrentUser | null> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function post(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new AuthError(data.error || `HTTP ${response.status}`, data.code);
  return data;
}

export const login = (email: string, password: string): Promise<CurrentUser> =>
  post('/api/auth/login', { email, password });

export async function register(email: string, password: string, displayName: string): Promise<void> {
  await post('/api/auth/register', { email, password, display_name: displayName });
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout');
}

export function installUnauthorizedHandler(onUnauthorized: () => void): () => void {
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const response = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (response.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/login')) {
      onUnauthorized();
    }
    return response;
  };
  return () => {
    window.fetch = original;
  };
}
```

- [x] **Step 5: Implement `adminUsers.ts`**

```ts
// src/api/adminUsers.ts
export type AdminUser = {
  id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'disabled';
  daily_ai_limit: number;
  created_at: string;
  ai_used_today: number;
};

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}

export const listUsers = () => call<AdminUser[]>('/api/admin/users', 'GET');
export const approveUser = (id: string) => call<AdminUser>(`/api/admin/users/${id}/approve`, 'POST');
export const disableUser = (id: string) => call<AdminUser>(`/api/admin/users/${id}/disable`, 'POST');
export const enableUser = (id: string) => call<AdminUser>(`/api/admin/users/${id}/enable`, 'POST');
export const setDailyLimit = (id: string, limit: number) =>
  call<AdminUser>(`/api/admin/users/${id}`, 'PATCH', { daily_ai_limit: limit });
export const resetPassword = (id: string, password: string) =>
  call<{ ok: true }>(`/api/admin/users/${id}/reset-password`, 'POST', { password });
```

- [x] **Step 6: Update the quota type.** In `src/api/llmProviders.ts` change

`export type AnalyzeQuota = { shared: false } | { shared: true; used: number; limit: number };`
to
`export type AnalyzeQuota = { capped: false } | { capped: true; used: number; limit: number };`

Then run `grep -rn "\.shared" src tests/lib tests/client` and fix any other reader of the old field. (`src/App.tsx` is fixed in Task 10; `tsc` will flag it until then, so **do not run `tsc` between this step and Task 10 Step 4**; the commit for this task therefore leaves `tsc` red on that one line. To keep every commit green, apply the one-line `analyzeQuota?.shared` → `analyzeQuota?.capped` change in `src/App.tsx` (line ~1657) here as well.)

- [x] **Step 7: Make the dev proxy target configurable** (so a second dev server can point at a scratch API without touching your real one). In `vite.config.ts` change `target: 'http://localhost:8787',` to `target: process.env.API_TARGET || 'http://localhost:8787',` and add `port: Number(process.env.DEV_PORT) || 3577,` in place of `port: 3577,`.

- [x] **Step 8: Run** — `npx vitest run tests/lib tests/client && npx tsc -b` → PASS/clean.
- [x] **Step 9: Commit**

```bash
git add src/api/auth.ts src/api/adminUsers.ts src/lib/userStorage.ts src/api/llmProviders.ts src/App.tsx vite.config.ts tests/lib/auth-api.test.ts tests/lib/user-storage.test.ts
git commit -m "feat: add client auth API, per-user storage keys and admin API client"
```

---

## Task 10: Login screen, AuthGate and per-user App state

**Files:**
- Create: `src/ui/LoginScreen.tsx`, `src/ui/AuthGate.tsx`
- Modify: `src/main.tsx`, `src/App.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `fetchMe, login, register, logout, installUnauthorizedHandler, AuthError, CurrentUser`, `migrateLegacyStorage, storageKeysFor, StorageKeys`.
- Produces: `<AuthGate />` (default export of `main.tsx`'s render target) which renders `LoginScreen` when signed out and `<App key={user.id} user={user} onLogout={...} />` when signed in. `App` now takes props `{ user: CurrentUser; onLogout: () => void }` and reads/writes browser state through `storageKeysFor(user.id)`.
- `LoginScreen` props: `{ onSignedIn: (user: CurrentUser) => void }`. Modes: `login`, `register`, `pending` (after registering, or after a login that returned `code: 'pending'`). Persists its own pre-login language/theme choice in `localStorage['gold-cockpit-login-prefs']` (`{ lang: 'ar' | 'en', theme: 'dark' | 'light' }`, default `ar`/`dark`) and toggles `body.theme-light` itself.

- [x] **Step 1: Style the new input types.** In `src/styles.css`, change the selector line `input[type="text"], input[type="number"], input[type="date"], select {` to `input[type="text"], input[type="number"], input[type="date"], input[type="email"], input[type="password"], select {` (check the neighbouring `:focus` rule and extend its selector list the same way).

- [x] **Step 2: Create `LoginScreen.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { AuthError, login, register, type CurrentUser } from '../api/auth';
import { Icon } from './primitives';

type Lang = 'ar' | 'en';
type Prefs = { lang: Lang; theme: 'dark' | 'light' };
const PREFS_KEY = 'gold-cockpit-login-prefs';

const TEXT = {
  en: {
    title: 'Gold Cockpit', signIn: 'Sign in', createAccount: 'Create account', email: 'Email', password: 'Password',
    name: 'Your name', signInBtn: 'Sign in', registerBtn: 'Request access', toRegister: 'New here? Request an account',
    toLogin: 'Already approved? Sign in', pendingTitle: 'Waiting for approval',
    pendingBody: 'Your account was created. The admin has to approve it before you can sign in.',
    backToLogin: 'Back to sign in', minPw: 'At least 8 characters', busy: 'Please wait…',
    langBtn: 'عربي', toDark: 'Switch to dark mode', toLight: 'Switch to light mode',
    disabled: 'This account is disabled. Contact the admin.',
  },
  ar: {
    title: 'كوكبيت الذهب', signIn: 'تسجيل الدخول', createAccount: 'إنشاء حساب', email: 'البريد الإلكتروني', password: 'كلمة المرور',
    name: 'اسمك', signInBtn: 'دخول', registerBtn: 'طلب حساب', toRegister: 'جديد؟ اطلب حساباً',
    toLogin: 'تمت الموافقة؟ سجّل الدخول', pendingTitle: 'بانتظار الموافقة',
    pendingBody: 'تم إنشاء حسابك. يجب أن يوافق المدير عليه قبل أن تتمكن من الدخول.',
    backToLogin: 'العودة لتسجيل الدخول', minPw: '٨ أحرف على الأقل', busy: 'لحظة…',
    langBtn: 'EN', toDark: 'التحويل للوضع الداكن', toLight: 'التحويل للوضع الفاتح',
    disabled: 'هذا الحساب معطّل. تواصل مع المدير.',
  },
} as const;

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && (parsed.lang === 'ar' || parsed.lang === 'en') && (parsed.theme === 'dark' || parsed.theme === 'light')) return parsed;
  } catch { /* fall through to defaults */ }
  return { lang: 'ar', theme: 'dark' };
}

export function LoginScreen({ onSignedIn }: { onSignedIn: (user: CurrentUser) => void }) {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [mode, setMode] = useState<'login' | 'register' | 'pending'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = TEXT[prefs.lang];
  const ar = prefs.lang === 'ar';

  useEffect(() => {
    document.body.classList.toggle('theme-light', prefs.theme === 'light');
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage may be blocked */ }
  }, [prefs]);

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'register') {
        await register(email, password, name);
        setMode('pending');
      } else {
        onSignedIn(await login(email, password));
      }
    } catch (err) {
      if (err instanceof AuthError && err.code === 'pending') setMode('pending');
      else if (err instanceof AuthError && err.code === 'disabled') setError(t.disabled);
      else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir={ar ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--bg)' }}>
      <div className="instrument-card" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{t.title}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn-outline" style={{ padding: '6px 10px' }} onClick={() => setPrefs({ ...prefs, lang: ar ? 'en' : 'ar' })}>{t.langBtn}</button>
            <button
              type="button"
              className="btn-outline"
              style={{ padding: '6px 10px', display: 'flex', alignItems: 'center' }}
              aria-label={prefs.theme === 'light' ? t.toDark : t.toLight}
              onClick={() => setPrefs({ ...prefs, theme: prefs.theme === 'light' ? 'dark' : 'light' })}
            >
              <Icon name={prefs.theme === 'light' ? 'moon' : 'sun'} size={14} />
            </button>
          </div>
        </div>

        {mode === 'pending' ? (
          <div>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{t.pendingTitle}</div>
            <p className="soft-text" style={{ lineHeight: 1.7, marginBottom: 16 }}>{t.pendingBody}</p>
            <button type="button" className="btn-outline" style={{ width: '100%', padding: 10 }} onClick={() => setMode('login')}>{t.backToLogin}</button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="section-label">{mode === 'login' ? t.signIn : t.createAccount}</div>
            {mode === 'register' && (
              <input type="text" placeholder={t.name} value={name} autoComplete="name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            )}
            <input type="email" placeholder={t.email} value={email} autoComplete="email" required onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
            <input
              type="password"
              placeholder={mode === 'register' ? `${t.password} — ${t.minPw}` : t.password}
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={mode === 'register' ? 8 : undefined}
              required
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
            {error && <div role="alert" className="down-text" style={{ fontSize: 14 }}>{error}</div>}
            <button type="submit" className="btn-primary" style={{ padding: 12 }} disabled={busy}>
              {busy ? t.busy : mode === 'login' ? t.signInBtn : t.registerBtn}
            </button>
            <button type="button" className="btn-outline" style={{ padding: 10 }} onClick={() => { setError(null); setMode(mode === 'login' ? 'register' : 'login'); }}>
              {mode === 'login' ? t.toRegister : t.toLogin}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

(If `.down-text` or `.soft-text` do not exist as classes, use the existing equivalents — `grep -n "^\.soft-text\|^\.down-text\|^\.muted-text" src/styles.css` — or inline `style={{ color: 'var(--down)' }}` / `var(--text-soft)`.)

- [x] **Step 3: Create `AuthGate.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import App from '../App';
import { fetchMe, logout, installUnauthorizedHandler, type CurrentUser } from '../api/auth';
import { migrateLegacyStorage } from '../lib/userStorage';
import { LoginScreen } from './LoginScreen';

type Phase = { kind: 'loading' } | { kind: 'anon' } | { kind: 'authed'; user: CurrentUser };

function enter(user: CurrentUser): Phase {
  try { migrateLegacyStorage(window.localStorage, user); } catch { /* storage may be blocked */ }
  return { kind: 'authed', user };
}

export function AuthGate() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    fetchMe()
      .then((user) => setPhase(user ? enter(user) : { kind: 'anon' }))
      .catch(() => setPhase({ kind: 'anon' }));
  }, []);

  useEffect(() => installUnauthorizedHandler(() => setPhase({ kind: 'anon' })), []);

  if (phase.kind === 'loading') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} aria-busy="true" />;
  }
  if (phase.kind === 'anon') {
    return <LoginScreen onSignedIn={(user) => setPhase(enter(user))} />;
  }
  return (
    <App
      key={phase.user.id}
      user={phase.user}
      onLogout={async () => {
        try { await logout(); } finally { setPhase({ kind: 'anon' }); }
      }}
    />
  );
}
```

- [x] **Step 4: Render the gate.** Replace `src/main.tsx` with:

```tsx
import { render } from 'preact';
import { AuthGate } from './ui/AuthGate';
import './styles.css';

render(<AuthGate />, document.getElementById('app')!);
```

- [x] **Step 5: Give `App` a user and per-user storage.** In `src/App.tsx`:
  1. Add imports: `import type { CurrentUser } from './api/auth';` and `import { storageKeysFor, type StorageKeys } from './lib/userStorage';`.
  2. Delete the three constants `STORAGE_KEY`, `MONITORS_KEY`, `LEVEL_KEY` (lines ~202-204).
  3. Change `function loadState(): AppState {` to `function loadState(keys: StorageKeys): AppState {` and replace inside it `STORAGE_KEY` → `keys.state`, `MONITORS_KEY` → `keys.monitors`, `LEVEL_KEY` → `keys.level`.
  4. Change `function App() {` to `function App({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {` and its first line to:
     ```tsx
       const storageKeys = useMemo(() => storageKeysFor(user.id), [user.id]);
       const [state, setState] = useState<AppState>(() => loadState(storageKeys));
     ```
  5. In the save effect replace the three `setItem` keys the same way (`storageKeys.state`, `storageKeys.monitors`, `storageKeys.level`) and add `storageKeys` to that effect's dependency array.
  6. `onLogout` and `user` are used in Task 11; to keep `tsc` free of unused-parameter errors right now, reference them in the `Sidebar` call in Task 11 in the same commit? No: this task ends with `App` receiving them; destructure only what is used (`user`) and add `onLogout` in Task 11. So use `function App({ user }: { user: CurrentUser; onLogout: () => void }) {` here.

- [x] **Step 6: Type-check and test** — `npx tsc -b && npm test` → clean/green.
- [x] **Step 7: Verify in the browser against a scratch database** (do not touch your real database or server):

```bash
psql postgres://localhost:5432/postgres -qc 'create database gold_cockpit_ui_try'
export DATABASE_URL=postgres://localhost:5432/gold_cockpit_ui_try SERVER_PORT=8788
npm run migrate
ADMIN_PASSWORD='try-password-1' node scripts/create-admin.mjs admin@try.com --name Boss
node server/index.mjs &                                  # API on 8788
API_TARGET=http://localhost:8788 DEV_PORT=3588 npx vite &   # UI on 3588
```
With Playwright at `http://localhost:3588/`, confirm: (1) the login screen shows (RTL Arabic by default); language and theme toggles work and persist across reload; (2) signing in as `admin@try.com` shows the cockpit; (3) reload keeps you signed in; (4) registering `bob@try.com` shows the "waiting for approval" screen and signing in as bob shows the same; (5) a wrong password shows the error. Screenshot the login screen at 390px and 1280px in both languages and both themes. Leave the servers running for Tasks 11-12 (stop them in Task 12).

- [x] **Step 8: Commit**

```bash
git add src/ui/LoginScreen.tsx src/ui/AuthGate.tsx src/main.tsx src/App.tsx src/styles.css
git commit -m "feat: add login/register screen and per-user browser storage"
```

---

## Task 11: Hide Settings from regular users; identity, logout and quota

**Files:**
- Modify: `src/ui/Sidebar.tsx`, `src/ui/BottomNav.tsx`, `src/App.tsx`

**Interfaces:**
- `Sidebar` gains props `isAdmin: boolean`, `userName: string`, `onLogout: () => void`, `settingsBadge?: number` (renders a small count badge on the Settings item when > 0). `BottomNav` gains `isAdmin`, `userName`, `onLogout`, `settingsBadge?`. Non-admins never see Settings in either.
- `App`: `isAdmin = user.role === 'admin'`; the `settings` tab renders only for admins, and a non-admin whose active tab is `settings` (e.g. from `?tab=settings`) is moved to `home`. `onLogout` is now used. The Analyst screen already shows the quota line via `analyzeQuota?.capped` (Task 9); make sure its wording reads as a daily quota for the signed-in user.

- [x] **Step 1: Sidebar.** In `src/ui/Sidebar.tsx`: add the four props to the destructuring and type; derive `const screens = isAdmin ? SCREEN_ORDER : SCREEN_ORDER.filter((s) => s !== 'settings');` and map over `screens` instead of `SCREEN_ORDER`. After the language/theme row in the footer (above the live dot) add a user row:

```tsx
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingInlineStart: 4 }}>
          <span className="muted-text" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={userName}>
            {userName}
          </span>
          <button type="button" className="btn-outline" style={{ padding: '4px 10px', fontSize: 13 }} onClick={onLogout}>
            {ar ? 'خروج' : 'Log out'}
          </button>
        </div>
```

For the badge, inside the `nav-item` button after the label span add, only when `s === 'settings' && settingsBadge`: `<span style={{ marginInlineStart: 'auto', background: 'var(--gold)', color: 'var(--bg)', borderRadius: 999, padding: '0 7px', fontSize: 12, fontWeight: 700 }}>{settingsBadge}</span>`.

- [x] **Step 2: BottomNav.** In `src/ui/BottomNav.tsx`: add the same four props; `const moreScreens = isAdmin ? MORE_SCREENS : MORE_SCREENS.filter((s) => s.key !== 'settings');` and use `moreScreens` for both the `isMoreActive` check and the sheet list; append the badge to the Settings entry as above; in the sheet, after the list and above the language/theme row add:

```tsx
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 4px 0' }}>
              <span className="muted-text" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userName}</span>
              <button type="button" className="btn-outline" style={{ padding: '6px 12px', fontSize: 14 }} onClick={() => { setSheetOpen(false); onLogout(); }}>
                {ar ? 'خروج' : 'Log out'}
              </button>
            </div>
```

- [x] **Step 3: App.** In `src/App.tsx`: destructure `{ user, onLogout }`; add `const isAdmin = user.role === 'admin';` and `const userName = user.display_name || user.email;`. Pass `isAdmin`, `userName`, `onLogout` (and `settingsBadge={pendingCount}` once Task 12 defines it — for now omit) to both `<Sidebar>` and `<BottomNav>`. Change `{activeTab === 'settings' && (` to `{activeTab === 'settings' && isAdmin && (`. Add, next to the other `useEffect`s:

```tsx
  useEffect(() => {
    if (!isAdmin && activeTab === 'settings') setActiveTab('home');
  }, [isAdmin, activeTab]);
```

- [x] **Step 4: Verify** — `npx tsc -b && npm test`, then in the browser (servers from Task 10 still running): approve bob via the API for now using the admin session is not possible from the browser yet, so approve directly: `psql "$DATABASE_URL" -c "update users set status='active' where email='bob@try.com'"` and confirm: (1) admin sees Settings in the sidebar and the More sheet; (2) bob sees neither, and `http://localhost:3588/?tab=settings` lands on Market for bob; (3) Log out returns to the login screen from both the sidebar (desktop) and the More sheet (390px); (4) bob's Analyst screen shows the quota line and the admin's does not; (5) as bob, `fetch('/api/llm-providers')` in the console returns 403. Screenshot both roles at 1280px and 390px.
- [x] **Step 5: Commit**

```bash
git add src/ui/Sidebar.tsx src/ui/BottomNav.tsx src/App.tsx
git commit -m "feat: hide Settings from regular users and add identity and logout"
```

---

## Task 12: Admin Users panel and pending badge

**Files:**
- Create: `src/ui/UsersPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `listUsers, approveUser, disableUser, enableUser, setDailyLimit, resetPassword, AdminUser`.
- Produces: `<UsersPanel ar={boolean} currentUserId={string} onPendingCount={(n: number) => void} />`. Loads on mount, refreshes after every action, reports the pending count upward, disables actions on the current admin's own row, shows errors inline, and is fully bilingual.
- `App` (admin only): keeps `pendingCount` state, initialised by a `listUsers()` call on mount, updated by `onPendingCount`; passes it as `settingsBadge` to `Sidebar` and `BottomNav`; renders `<UsersPanel …/>` below `<AIModelSettingsManager …/>` in the Settings tab.

- [x] **Step 1: Create `UsersPanel.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import {
  approveUser, disableUser, enableUser, listUsers, resetPassword, setDailyLimit, type AdminUser,
} from '../api/adminUsers';
import { Card, SectionLabel } from './primitives';

const TEXT = {
  en: {
    title: 'Users', pending: 'pending', active: 'Active', disabled: 'Disabled', pendingS: 'Pending',
    approve: 'Approve', disable: 'Disable', enable: 'Enable', save: 'Save', limit: 'Daily analyses',
    used: 'used today', reset: 'Reset password', newPassword: 'New password for', minPw: 'At least 8 characters.',
    admin: 'Admin', none: 'No users yet.', you: 'you', loading: 'Loading…', done: 'Password changed.',
  },
  ar: {
    title: 'المستخدمون', pending: 'بانتظار الموافقة', active: 'نشط', disabled: 'معطّل', pendingS: 'بانتظار الموافقة',
    approve: 'موافقة', disable: 'تعطيل', enable: 'تفعيل', save: 'حفظ', limit: 'التحليلات اليومية',
    used: 'استُخدم اليوم', reset: 'إعادة تعيين كلمة المرور', newPassword: 'كلمة مرور جديدة لـ', minPw: '٨ أحرف على الأقل.',
    admin: 'مدير', none: 'لا يوجد مستخدمون بعد.', you: 'أنت', loading: 'جارٍ التحميل…', done: 'تم تغيير كلمة المرور.',
  },
} as const;

export function UsersPanel({ ar, currentUserId, onPendingCount }: { ar: boolean; currentUserId: string; onPendingCount: (n: number) => void }) {
  const t = TEXT[ar ? 'ar' : 'en'];
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await listUsers();
      setUsers(list);
      setLimits(Object.fromEntries(list.map((u) => [u.id, String(u.daily_ai_limit)])));
      onPendingCount(list.filter((u) => u.status === 'pending').length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function act(action: () => Promise<unknown>, message?: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      if (message) setNotice(message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const statusLabel = (u: AdminUser) => (u.status === 'pending' ? t.pendingS : u.status === 'active' ? t.active : t.disabled);

  return (
    <div style={{ marginTop: 24 }}>
      <SectionLabel text={t.title.toUpperCase()} />
      {error && <div role="alert" style={{ color: 'var(--down)', marginBottom: 8, fontSize: 14 }}>{error}</div>}
      {notice && <div role="status" style={{ color: 'var(--up)', marginBottom: 8, fontSize: 14 }}>{notice}</div>}
      {users === null ? (
        <div className="soft-text">{t.loading}</div>
      ) : users.length === 0 ? (
        <div className="soft-text">{t.none}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {users.map((u) => {
            const self = u.id === currentUserId;
            const limitChanged = limits[u.id] !== String(u.daily_ai_limit);
            return (
              <Card key={u.id} style={{ padding: 14 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                      {u.display_name || u.email} {self && <span className="muted-text" style={{ fontWeight: 400 }}>({t.you})</span>}
                      {u.role === 'admin' && <span className="muted-text" style={{ fontWeight: 400 }}> · {t.admin}</span>}
                    </div>
                    <div className="muted-text" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{u.email}</div>
                  </div>
                  <span
                    style={{
                      fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      color: u.status === 'active' ? 'var(--up)' : u.status === 'pending' ? 'var(--caution)' : 'var(--down)',
                      border: '1px solid currentColor',
                    }}
                  >
                    {statusLabel(u)}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 10 }}>
                  {u.role !== 'admin' && (
                    <>
                      <label className="muted-text" style={{ fontSize: 13 }}>{t.limit}</label>
                      <input
                        type="number" min={0} max={1000} style={{ width: 80 }}
                        value={limits[u.id] ?? ''}
                        onInput={(e) => setLimits({ ...limits, [u.id]: (e.target as HTMLInputElement).value })}
                      />
                      <button type="button" className="btn-outline" style={{ padding: '6px 10px' }} disabled={!limitChanged}
                        onClick={() => act(() => setDailyLimit(u.id, Number(limits[u.id])))}>
                        {t.save}
                      </button>
                      <span className="muted-text" style={{ fontSize: 13 }}>{u.ai_used_today} {t.used}</span>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {u.status === 'pending' && (
                    <button type="button" className="btn-primary" style={{ padding: '8px 14px' }} onClick={() => act(() => approveUser(u.id))}>{t.approve}</button>
                  )}
                  {u.status === 'active' && !self && (
                    <button type="button" className="btn-outline" style={{ padding: '8px 14px' }} onClick={() => act(() => disableUser(u.id))}>{t.disable}</button>
                  )}
                  {u.status === 'disabled' && (
                    <button type="button" className="btn-outline" style={{ padding: '8px 14px' }} onClick={() => act(() => enableUser(u.id))}>{t.enable}</button>
                  )}
                  <button
                    type="button" className="btn-outline" style={{ padding: '8px 14px' }}
                    onClick={() => {
                      const password = window.prompt(`${t.newPassword} ${u.email}\n${t.minPw}`);
                      if (password) void act(() => resetPassword(u.id, password), t.done);
                    }}
                  >
                    {t.reset}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 2: Mount it and wire the badge in `App.tsx`.** Import `UsersPanel` and `listUsers`. Add `const [pendingCount, setPendingCount] = useState(0);` and

```tsx
  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then((list) => setPendingCount(list.filter((u) => u.status === 'pending').length)).catch(() => {});
  }, [isAdmin]);
```

Pass `settingsBadge={pendingCount}` to `Sidebar` and `BottomNav`. In the Settings tab, below `<AIModelSettingsManager adapter={aiSettingsAdapter} />` add `<UsersPanel ar={ar} currentUserId={user.id} onPendingCount={setPendingCount} />`.

- [x] **Step 3: Verify** — `npx tsc -b && npm test`, then in the browser (servers from Task 10 still running; register a fresh `carol@try.com` first so there is a pending user): (1) admin sees a badge `1` on Settings; (2) the Users panel lists carol as pending first; **Approve** makes her active and drops the badge; (3) set her daily limit to 1, Save, then sign in as carol in a second browser context and run one analysis attempt against a stub provider (or confirm the quota line reads `1/1`, then `0/1` after the 429 path via a direct `fetch('/api/analyze', {method:'POST', ...})` returning 429 once the count is 1 — set `ai_shared_usage` by SQL if no provider is reachable); (4) **Disable** carol, then her open session gets back to the login screen on its next request; **Enable** restores her; (5) **Reset password** (accept the prompt with a new 8+ char password) lets carol sign in with it; (6) the admin's own row has no Disable button; (7) the panel is usable at 390px in Arabic (no horizontal overflow). Screenshot desktop + mobile, both languages.
- [x] **Step 4: Commit**

```bash
git add src/ui/UsersPanel.tsx src/App.tsx
git commit -m "feat: add the admin Users panel with approvals, limits and password reset"
```

---

## Task 13: Docs, spec update, end-to-end check and cleanup

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-20-multi-user-admin-design.md`
- Modify: `docs/superpowers/plans/2026-09-20-multi-user-admin.md` (check off completed steps)

- [x] **Step 1: Stop the scratch servers and drop the scratch database**

```bash
pkill -f "SERVER_PORT=8788" || true
kill %1 %2 2>/dev/null || true
unset DATABASE_URL SERVER_PORT
psql postgres://localhost:5432/postgres -qc 'drop database if exists gold_cockpit_ui_try'
```

- [x] **Step 2: Upgrade path check on a copy of your real data** (proves the migration and `create-admin` keep your data). The dump is made with `--no-keys` so no API keys are written to disk:

```bash
scripts/db-export.sh --no-keys --out db-export/upgrade-check.sql
psql postgres://localhost:5432/postgres -qc 'create database gold_cockpit_upgrade_check'
DATABASE_URL=postgres://localhost:5432/gold_cockpit_upgrade_check scripts/db-import.sh db-export/upgrade-check.sql --yes
```
Note: your real database is still at migration 0023, so the import ends with `Applying any migrations newer than the dump…` and applies **0024**. Then:

```bash
export DATABASE_URL=postgres://localhost:5432/gold_cockpit_upgrade_check
psql "$DATABASE_URL" -c "select email, role, status from users"          # expect default@local | user | active
ADMIN_PASSWORD='upgrade-check-1' node scripts/create-admin.mjs me@example.com
psql "$DATABASE_URL" -c "select email, role, status from users"          # expect me@example.com | admin | active
psql "$DATABASE_URL" -c "select count(*) from wallet_snapshots"          # expect the same count as your real DB (18)
unset DATABASE_URL
psql postgres://localhost:5432/postgres -qc 'drop database gold_cockpit_upgrade_check'
rm -f db-export/upgrade-check.sql
```

- [x] **Step 3: README section.** Append to `README.md`:

```markdown
## Users and admin

Gold Cockpit is multi-user. Everyone signs in; only the admin can open **Settings**
(AI model configuration and the Users panel). Every user has their own wallet, DCA
plan, scenario weights, watchlist and alerts. All analyses run on the admin's
active AI provider; each regular user has a daily analysis limit (default 3) that
the admin can change per user.

**First-time setup (once per machine, before starting the server):**

    npm run migrate
    node scripts/create-admin.mjs you@example.com     # prompts for a password

On an existing single-user database this converts the old `default@local` user into
the admin and keeps all its data. The server refuses to start until an admin exists.
If you restore a database exported from another machine that already has an admin,
skip this step.

**New users** register on the login screen and stay "pending" until the admin
approves them in Settings → Users. The admin can also disable a user, change their
daily analysis limit and reset their password there.

Behind a reverse proxy that terminates HTTPS, set `TRUST_PROXY=1` so the session
cookie is marked `Secure` and login rate limiting sees real client addresses.
```

- [x] **Step 4: Update the spec** (`docs/superpowers/specs/2026-09-20-multi-user-admin-design.md`) so it matches what was built. Make exactly these four edits:
  1. Under "Access control", replace "Routers stop taking a boot-time `userId`; handlers use `req.user.id`." with "The router factories keep their `(db, userId)` signature; `perUserRouter` builds one router per logged-in user and delegates to it, so routers and their tests are unchanged."
  2. In the same section replace "The old `GOLD_COCKPIT_API_KEY` middleware is removed." with "The old optional `GOLD_COCKPIT_API_KEY` header check inside each router is left untouched: it does nothing when the variable is unset, and the browser never sent it."
  3. Under "Analysis": replace "(HTTP 429)" wording so it reads: quota endpoint returns `{ capped: false }` for the admin and `{ capped: true, used, limit }` for regular users; the cap returns HTTP 429 `Daily analysis limit reached`.
  4. Under "Admin routes" add a line: "`/api/software-review` is admin-only (it drives a server-side tool and the client never calls it)."

- [x] **Step 5: Final verification** — `npx tsc -b && npm test` (expect all green; note the new total), and `git status --short` shows only the known unrelated files.

- [x] **Step 6: Check off this plan and commit**

```bash
sed -i '' 's/^- \[ \]/- [x]/' docs/superpowers/plans/2026-09-20-multi-user-admin.md
git add README.md docs/superpowers/specs/2026-09-20-multi-user-admin-design.md docs/superpowers/plans/2026-09-20-multi-user-admin.md
git commit -m "docs: document multi-user setup and update the spec to match the build"
```

- [ ] **Step 7: Finish the branch.** Use superpowers:finishing-a-development-branch (this work should be done in a worktree; see the execution handoff below).

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), passwords and sessions (2, 3), register/login/logout/me + rate limit (4), first admin + per-user defaults (5), login required everywhere and admin-only areas (6), approve/disable/enable/limit/reset with self-protection (7), admin's provider + daily cap + quota (8), client auth, per-user storage, 401 handling (9, 10), Settings hidden + identity + logout + quota (11), Users panel + pending badge (12), migration/rollout/docs (13). The startup "refuse without admin" is in Task 6.
- **Placeholder scan:** no TBD/TODO; every code step has complete code. The two conditional class-name fallbacks in Task 10 (`soft-text`/`down-text`) name the exact grep and the exact inline replacement.
- **Type consistency:** `CurrentUser` (Task 9) is what `me`/`login` return (Task 4 `loadMe`); `AdminUser` matches the `GET /users` columns (Task 7); `StorageKeys` is produced in Task 9 and consumed in Task 10; `AnalyzeQuota.capped` is produced by Task 8's server and consumed by Task 9's type and `App`; `createAnalyzeRouter(db, userId, { providerOwnerId })` is called that way in Task 6 and implemented in Task 8 (the extra argument is ignored until then, as noted); `createApp(db, { adminId, authRateLimit })` signature is identical in Tasks 6 and 7 tests.
- **Known accepted risks:** two concurrent analyses can both pass the cap check and exceed the limit by one; `register` reveals whether an email is taken (409) — acceptable for an approval-gated internal tool; provider API keys remain plaintext in the database (unchanged), now readable only by the admin.
