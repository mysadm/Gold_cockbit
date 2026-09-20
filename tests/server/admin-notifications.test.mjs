import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { raiseNotification, resolveNotifications, listOpen, dismiss } from '../../server/adminNotifications.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);
let client;

beforeEach(async () => { client = await resetAndMigrate(MIGRATIONS_DIR); });
afterEach(async () => { await client.end(); });

const total = async () => Number((await client.query('SELECT count(*) FROM admin_notifications')).rows[0].count);

describe('admin notifications', () => {
  it('raises one open row per kind and updates it in place on the next raise', async () => {
    await raiseNotification(client, { kind: 'k', message: 'first', detail: { attempts: 1 } });
    await client.query(`UPDATE admin_notifications SET created_at = now() - interval '2 hours', updated_at = now() - interval '1 hour'`);
    await raiseNotification(client, { kind: 'k', message: 'second', detail: { attempts: 2 } });
    expect(await total()).toBe(1);
    const open = await listOpen(client);
    expect(open).toHaveLength(1);
    expect(open[0].message).toBe('second');
    expect(new Date(open[0].updated_at).getTime()).toBeGreaterThan(new Date(open[0].created_at).getTime() + 30 * 60 * 1000);
    const { rows } = await client.query('SELECT detail FROM admin_notifications');
    expect(rows[0].detail).toEqual({ attempts: 2 });
  });

  it('returns only the public fields with a numeric id and ISO-able dates', async () => {
    await raiseNotification(client, { kind: 'k', message: 'm', detail: { secret: 1 } });
    const [row] = await listOpen(client);
    expect(Object.keys(row).sort()).toEqual(['created_at', 'id', 'kind', 'message', 'updated_at']);
    expect(typeof row.id).toBe('number');
    expect(Number.isFinite(Date.parse(row.created_at))).toBe(true);
  });

  it('keeps kinds independent', async () => {
    await raiseNotification(client, { kind: 'a', message: 'A' });
    await raiseNotification(client, { kind: 'b', message: 'B' });
    expect((await listOpen(client)).map((n) => n.kind).sort()).toEqual(['a', 'b']);
  });

  it('resolve closes the open row, and a new open row can be created afterwards', async () => {
    await raiseNotification(client, { kind: 'k', message: 'old' });
    await resolveNotifications(client, 'k');
    expect(await listOpen(client)).toEqual([]);
    await raiseNotification(client, { kind: 'k', message: 'new' });
    const open = await listOpen(client);
    expect(open.map((n) => n.message)).toEqual(['new']);
    expect(await total()).toBe(2);
  });

  it('resolve is a no-op when nothing is open and only touches its own kind', async () => {
    await resolveNotifications(client, 'nothing');
    await raiseNotification(client, { kind: 'a', message: 'A' });
    await resolveNotifications(client, 'b');
    expect(await listOpen(client)).toHaveLength(1);
  });

  it('dismiss closes one row by id and reports whether it did', async () => {
    await raiseNotification(client, { kind: 'a', message: 'A' });
    const [row] = await listOpen(client);
    expect(await dismiss(client, row.id)).toBe(true);
    expect(await listOpen(client)).toEqual([]);
    expect(await dismiss(client, row.id)).toBe(false);
    expect(await dismiss(client, 999999)).toBe(false);
  });

  it('lists newest first', async () => {
    await raiseNotification(client, { kind: 'a', message: 'A' });
    await raiseNotification(client, { kind: 'b', message: 'B' });
    expect((await listOpen(client)).map((n) => n.kind)).toEqual(['b', 'a']);
  });
});
