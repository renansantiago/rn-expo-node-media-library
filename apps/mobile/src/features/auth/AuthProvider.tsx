import type { LoginRequest, User } from '@media-library/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useApiClient } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { KeyValueStore } from '../../lib/storage/key-value-store';
import { fetchMe, login as loginRequest, logout as logoutRequest } from './api';
import { loadSession, persistSession, type SessionStore } from './session';

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login(credentials: LoginRequest): Promise<User>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface Props {
  sessionStore: SessionStore;
  storage: KeyValueStore;
  children: ReactNode;
}

export function AuthProvider({ sessionStore, storage, children }: Props) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
  const [restored, setRestored] = useState(false);

  // Restore the persisted session, then keep storage in sync with every change (login, logout,
  // or the API client clearing an expired session on 401).
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void loadSession(storage).then((stored) => {
      if (cancelled) return;
      if (stored && !sessionStore.get()) sessionStore.set(stored);
      setRestored(true);
      unsubscribe = sessionStore.subscribe((next) => {
        persistSession(storage, next).catch((err) => logger.error('auth.persist_failed', { err }));
        // Anything user-specific must not survive a change of user.
        if (!next) queryClient.removeQueries({ queryKey: ['user'] });
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient, sessionStore, storage]);

  // Refresh the profile (e.g. tier changes) once per restored session. Offline failures are
  // ignored: the cached session keeps working; a 401 clears it through the API client.
  const token = session?.token;
  useEffect(() => {
    if (!restored || !token) return;
    const controller = new AbortController();
    fetchMe(client, controller.signal)
      .then(({ user }) => {
        const current = sessionStore.get();
        if (current?.token === token) sessionStore.set({ ...current, user });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [client, restored, sessionStore, token]);

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const result = await loginRequest(client, credentials);
      sessionStore.set(result);
      logger.info('auth.login', { userId: result.user.id });
      return result.user;
    },
    [client, sessionStore],
  );

  const logout = useCallback(async () => {
    // Revoke server-side on a best-effort basis; signing out locally must always succeed.
    await logoutRequest(client).catch(() => undefined);
    sessionStore.set(null);
    logger.info('auth.logout');
  }, [client, sessionStore]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: !restored ? 'restoring' : session ? 'signedIn' : 'signedOut',
      user: session?.user ?? null,
      login,
      logout,
    }),
    [login, logout, restored, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
