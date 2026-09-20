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
