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
