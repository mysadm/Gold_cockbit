import { describe, it, expect, afterEach } from 'vitest';
import { resetAndMigrate } from '../helpers/test-db.mjs';
import { getSetting, setSetting } from '../../server/appSettings.mjs';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

let client;

afterEach(async () => {
  await client.end();
});

describe('appSettings', () => {
  it('returns null for a missing key', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    expect(await getSetting(client, 'nope')).toBeNull();
  });

  it('round-trips a JSON value', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    const value = { enabled: true, times: ['08:00', '16:00'], tz: 'Africa/Cairo', language: 'ar' };
    await setSetting(client, 'analysis_schedule', value);
    expect(await getSetting(client, 'analysis_schedule')).toEqual(value);
  });

  it('overwrites an existing key', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    await setSetting(client, 'k', { a: 1 });
    await setSetting(client, 'k', { a: 2 });
    expect(await getSetting(client, 'k')).toEqual({ a: 2 });
    const { rows } = await client.query("SELECT count(*)::int AS n FROM app_settings WHERE key = 'k'");
    expect(rows[0].n).toBe(1);
  });

  it('creates the run and notification tables with the open-notification unique index', async () => {
    client = await resetAndMigrate(MIGRATIONS_DIR);
    await client.query("INSERT INTO admin_notifications (kind, message) VALUES ('k', 'm')");
    await expect(client.query("INSERT INTO admin_notifications (kind, message) VALUES ('k', 'm2')")).rejects.toThrow();
    await client.query("UPDATE admin_notifications SET resolved_at = now()");
    await client.query("INSERT INTO admin_notifications (kind, message) VALUES ('k', 'm3')");
    await client.query("INSERT INTO shared_analysis_runs (slot_key, status) VALUES ('s', 'running')");
    const { rows } = await client.query("SELECT attempts FROM shared_analysis_runs WHERE slot_key = 's'");
    expect(rows[0].attempts).toBe(1);
  });
});
