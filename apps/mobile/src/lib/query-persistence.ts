import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query } from '@tanstack/react-query';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import Constants from 'expo-constants';
import { logger } from './logger';

/** Bump when the shape of cached data changes; old caches are then discarded on launch. */
export const CACHE_SCHEMA_VERSION = 1;
/** Persisted queries older than this are dropped on restore. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Only the first pages of each catalog list are kept on disk (enough to browse offline). */
export const PERSISTED_PAGES_PER_LIST = 3;
export const PERSIST_STORAGE_KEY = 'query-cache.v1';

/** Discards caches written by another app version or cache schema. */
export const cacheBuster = (appVersion = Constants.expoConfig?.version ?? 'dev') =>
  `${CACHE_SCHEMA_VERSION}:${appVersion}`;

/**
 * Only public catalog data is written to disk. Anything user-scoped (stream URLs, progress reads)
 * lives under `['user', …]` keys and is never persisted, so nothing personal outlives a sign-out.
 */
export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  return query.state.status === 'success' && query.queryKey[0] === 'catalog';
}

interface InfiniteLike {
  pages: unknown[];
  pageParams: unknown[];
}
const isInfiniteData = (data: unknown): data is InfiniteLike =>
  typeof data === 'object' &&
  data !== null &&
  Array.isArray((data as InfiniteLike).pages) &&
  Array.isArray((data as InfiniteLike).pageParams);

/** Caps every infinite list at its first pages so the on-disk cache stays small. */
export function trimForStorage(client: PersistedClient): PersistedClient {
  return {
    ...client,
    clientState: {
      ...client.clientState,
      queries: client.clientState.queries.map((query) => {
        const data = query.state.data;
        if (!isInfiniteData(data) || data.pages.length <= PERSISTED_PAGES_PER_LIST) return query;
        return {
          ...query,
          state: {
            ...query.state,
            data: {
              pages: data.pages.slice(0, PERSISTED_PAGES_PER_LIST),
              pageParams: data.pageParams.slice(0, PERSISTED_PAGES_PER_LIST),
            },
          },
        };
      }),
    },
  };
}

export interface StringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Stands in for an unreadable cache: its buster never matches, so it is discarded on restore. */
const DISCARDED_CACHE: PersistedClient = {
  timestamp: 0,
  buster: 'unreadable',
  clientState: { queries: [], mutations: [] },
};

export function createQueryPersister(storage: StringStorage): Persister {
  return createAsyncStoragePersister({
    storage,
    key: PERSIST_STORAGE_KEY,
    throttleTime: 1_000,
    serialize: (client) => JSON.stringify(trimForStorage(client)),
    deserialize: (cached) => {
      try {
        return JSON.parse(cached) as PersistedClient;
      } catch (err) {
        // Truncated write, disk corruption…: start from the network rather than crash.
        logger.warn('cache.unreadable', { err });
        return DISCARDED_CACHE;
      }
    },
  });
}

export const persistOptions = (persister: Persister, buster = cacheBuster()) => ({
  persister,
  maxAge: PERSIST_MAX_AGE_MS,
  buster,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
});
