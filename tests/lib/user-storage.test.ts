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
