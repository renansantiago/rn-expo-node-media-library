import { LoginResponseSchema, type LoginResponse } from '@media-library/contracts';
import type { KeyValueStore } from '../../lib/storage/key-value-store';

export type Session = LoginResponse;

type Listener = (session: Session | null) => void;

/**
 * In-memory source of truth for the current session. The API client reads the token from it
 * synchronously; the AuthProvider exposes it to React and persists every change.
 */
export interface SessionStore {
  get(): Session | null;
  set(session: Session | null): void;
  subscribe(listener: Listener): () => void;
}

export function createSessionStore(initial: Session | null = null): SessionStore {
  let current = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => current,
    set: (session) => {
      if (session === current) return;
      current = session;
      listeners.forEach((listener) => listener(session));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const SESSION_STORAGE_KEY = 'auth.session.v1';

/** Reads the persisted session; corrupt, outdated or expired entries are discarded. */
export async function loadSession(
  storage: KeyValueStore,
  now: () => number = Date.now,
): Promise<Session | null> {
  const raw = await storage.get(SESSION_STORAGE_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const session = LoginResponseSchema.parse(JSON.parse(raw));
    if (Date.parse(session.expiresAt) <= now()) {
      await storage.remove(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    await storage.remove(SESSION_STORAGE_KEY);
    return null;
  }
}

export async function persistSession(storage: KeyValueStore, session: Session | null) {
  if (session) await storage.set(SESSION_STORAGE_KEY, JSON.stringify(session));
  else await storage.remove(SESSION_STORAGE_KEY);
}
