import { createMemoryStore } from '../../lib/storage/key-value-store';
import { makeSession } from '../../test/fixtures';
import { createSessionStore, loadSession, persistSession, SESSION_STORAGE_KEY } from './session';

describe('session store', () => {
  it('notifies subscribers on change and stops after unsubscribe', () => {
    const store = createSessionStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    const session = makeSession('free');
    store.set(session);
    store.set(session); // no-op: same value
    unsubscribe();
    store.set(null);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(session);
    expect(store.get()).toBeNull();
  });
});

describe('session persistence', () => {
  it('round-trips a valid session', async () => {
    const storage = createMemoryStore();
    const session = makeSession('premium');
    await persistSession(storage, session);
    expect(await loadSession(storage)).toEqual(session);
    await persistSession(storage, null);
    expect(await storage.get(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('discards expired sessions', async () => {
    const storage = createMemoryStore({
      [SESSION_STORAGE_KEY]: JSON.stringify(
        makeSession('free', { expiresAt: new Date(Date.now() - 1000).toISOString() }),
      ),
    });
    expect(await loadSession(storage)).toBeNull();
    expect(storage.snapshot()).toEqual({});
  });

  it.each(['not json', JSON.stringify({ token: 'x' })])('discards corrupt data %j', async (raw) => {
    const storage = createMemoryStore({ [SESSION_STORAGE_KEY]: raw });
    expect(await loadSession(storage)).toBeNull();
    expect(storage.snapshot()).toEqual({});
  });

  it('treats unreadable storage as signed out', async () => {
    const storage = {
      ...createMemoryStore(),
      get: () => Promise.reject(new Error('keychain locked')),
    };
    expect(await loadSession(storage)).toBeNull();
  });
});
