import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider, type Persister } from '@tanstack/react-query-persist-client';
import { useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../features/auth/AuthProvider';
import { createSessionStore, type SessionStore } from '../features/auth/session';
import { ProgressProvider } from '../features/progress/ProgressProvider';
import {
  ApiClientProvider,
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
} from '../lib/api';
import { config } from '../lib/config';
import { openAppDatabase, type SqlDatabase } from '../lib/db/database';
import { logger } from '../lib/logger';
import { createQueryClient } from '../lib/query-client';
import { createQueryPersister, persistOptions } from '../lib/query-persistence';
import { secureStore, type KeyValueStore } from '../lib/storage/key-value-store';
import { requestMetrics } from '../lib/telemetry';

interface Props {
  children: ReactNode;
  /** Injection points for tests. */
  createClient?: (session: SessionStore) => ApiClient;
  queryClient?: QueryClient;
  storage?: KeyValueStore;
  openDatabase?: () => Promise<SqlDatabase>;
  /** Offline catalog cache; `null` disables persistence (most tests). */
  persister?: Persister | null;
}

/** API client wired to the session: attaches the token and drops the session on 401. */
export function createSessionAwareClient(
  session: SessionStore,
  options: Pick<ApiClientOptions, 'baseUrl' | 'timeoutMs' | 'logger' | 'onRequestComplete'>,
): ApiClient {
  return createApiClient({
    ...options,
    getAuthToken: () => session.get()?.token,
    onUnauthorized: (token) => {
      // Only drop the session the server rejected (not a newer one from a re-login).
      if (session.get()?.token === token) {
        logger.warn('auth.session_expired');
        session.set(null);
      }
    },
  });
}

const defaultCreateClient = (session: SessionStore) =>
  createSessionAwareClient(session, {
    baseUrl: config.apiBaseUrl,
    timeoutMs: config.requestTimeoutMs,
    logger,
    onRequestComplete: requestMetrics.record,
  });

const defaultPersister = createQueryPersister(AsyncStorage);

export function AppProviders({
  children,
  createClient = defaultCreateClient,
  queryClient,
  storage = secureStore,
  openDatabase = openAppDatabase,
  persister = defaultPersister,
}: Props) {
  const [sessionStore] = useState(() => createSessionStore());
  const [client] = useState(() => createClient(sessionStore));
  const [queries] = useState(() => queryClient ?? createQueryClient());

  const app = (
    <ApiClientProvider client={client}>
      <AuthProvider sessionStore={sessionStore} storage={storage}>
        <ProgressProvider openDatabase={openDatabase}>{children}</ProgressProvider>
      </AuthProvider>
    </ApiClientProvider>
  );

  return (
    <SafeAreaProvider>
      {persister ? (
        // Restores the cached catalog before queries run, so the app opens offline with data.
        <PersistQueryClientProvider client={queries} persistOptions={persistOptions(persister)}>
          {app}
        </PersistQueryClientProvider>
      ) : (
        <QueryClientProvider client={queries}>{app}</QueryClientProvider>
      )}
    </SafeAreaProvider>
  );
}
