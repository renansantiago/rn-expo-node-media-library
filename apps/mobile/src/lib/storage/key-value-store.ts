import * as SecureStore from 'expo-secure-store';

/** Minimal async key/value storage, so features don't depend on a specific backend. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Keychain (iOS) / Keystore-backed (Android) storage, for credentials. */
export const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  snapshot(): Record<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => void data.set(key, value),
    remove: async (key) => void data.delete(key),
    snapshot: () => Object.fromEntries(data),
  };
}
