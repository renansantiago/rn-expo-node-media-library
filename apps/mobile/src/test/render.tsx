import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SESSION_STORAGE_KEY } from '../features/auth/session';
import type { SqlDatabase } from '../lib/db/database';
import { createLogger } from '../lib/logger';
import { createMemoryStore } from '../lib/storage/key-value-store';
import { AppProviders, createSessionAwareClient } from '../providers/AppProviders';
import { makeSession } from './fixtures';
import { createMigratedTestDatabase } from './sqlite';
import { TEST_API_URL } from './server';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

interface Options {
  timeoutMs?: number;
  /** Start signed in as this demo user (persisted session restored on mount). */
  signedInAs?: 'free' | 'premium';
  /** Local database; defaults to a fresh in-memory one per render. */
  database?: Promise<SqlDatabase>;
}

/** Renders inside the real providers, with a real API client pointed at the MSW fake API. */
export async function renderWithProviders(
  ui: ReactElement,
  { timeoutMs = 1_000, signedInAs, database = createMigratedTestDatabase() }: Options = {},
) {
  const storage = createMemoryStore(
    signedInAs ? { [SESSION_STORAGE_KEY]: JSON.stringify(makeSession(signedInAs)) } : {},
  );
  const queryClient = createTestQueryClient();
  const result = await render(
    <AppProviders
      storage={storage}
      queryClient={queryClient}
      openDatabase={() => database}
      createClient={(session) =>
        createSessionAwareClient(session, {
          baseUrl: TEST_API_URL,
          timeoutMs,
          logger: createLogger({ minLevel: 'silent' }),
        })
      }
    >
      {ui}
    </AppProviders>,
  );
  return { ...result, storage, queryClient, database };
}
