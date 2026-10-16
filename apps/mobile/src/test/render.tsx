import { PAGE_SIZE_DEFAULT, type Item } from '@media-library/contracts';
import { QueryClient } from '@tanstack/react-query';
import type { Persister } from '@tanstack/react-query-persist-client';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SESSION_STORAGE_KEY } from '../features/auth/session';
import { catalogKeys } from '../features/catalog/api';
import type { SqlDatabase } from '../lib/db/database';
import { createLogger } from '../lib/logger';
import { createMemoryStore } from '../lib/storage/key-value-store';
import { AppProviders, createSessionAwareClient } from '../providers/AppProviders';
import { CATALOG, makeSession } from './fixtures';
import { createMigratedTestDatabase } from './sqlite';
import { TEST_API_URL } from './server';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** A query client that already holds the first catalog page, as if "All" had been browsed. */
export function queryClientWithCatalog(items: Item[] = CATALOG.slice(0, PAGE_SIZE_DEFAULT)) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(catalogKeys.items({ category: null, limit: PAGE_SIZE_DEFAULT }), {
    pages: [{ data: items, nextCursor: null }],
    pageParams: [undefined],
  });
  return queryClient;
}

interface Options {
  timeoutMs?: number;
  /** Start signed in as this demo user (persisted session restored on mount). */
  signedInAs?: 'free' | 'premium';
  /** Local database; defaults to a fresh in-memory one per render. */
  database?: Promise<SqlDatabase>;
  /** Enables the offline query cache (off by default). */
  persister?: Persister;
  queryClient?: QueryClient;
}

/** Renders inside the real providers, with a real API client pointed at the MSW fake API. */
export async function renderWithProviders(
  ui: ReactElement,
  {
    timeoutMs = 1_000,
    signedInAs,
    database = createMigratedTestDatabase(),
    persister,
    queryClient = createTestQueryClient(),
  }: Options = {},
) {
  const storage = createMemoryStore(
    signedInAs ? { [SESSION_STORAGE_KEY]: JSON.stringify(makeSession(signedInAs)) } : {},
  );
  const result = await render(
    <AppProviders
      storage={storage}
      queryClient={queryClient}
      openDatabase={() => database}
      persister={persister ?? null}
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
