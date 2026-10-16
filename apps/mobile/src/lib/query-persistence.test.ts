import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import {
  cacheBuster,
  createQueryPersister,
  PERSIST_STORAGE_KEY,
  PERSISTED_PAGES_PER_LIST,
  shouldPersistQuery,
  trimForStorage,
} from './query-persistence';

const query = (queryKey: unknown[], status: 'success' | 'error' | 'pending', data?: unknown) =>
  ({ queryKey, queryHash: JSON.stringify(queryKey), state: { status, data } }) as never;

describe('shouldPersistQuery', () => {
  it.each([
    [['catalog', 'items', { category: null }], 'success', true],
    [['catalog', 'categories'], 'success', true],
    [['catalog', 'item', 'abc'], 'error', false],
    [['user', 'user-1', 'playback', 'abc'], 'success', false],
    [['user', 'user-1', 'progress', 'local', 'list'], 'success', false],
  ] as const)('%j (%s) → %s', (key, status, expected) => {
    expect(shouldPersistQuery(query([...key], status))).toBe(expected);
  });
});

describe('trimForStorage', () => {
  it('keeps only the first pages of infinite lists and leaves other data alone', () => {
    const pages = Array.from({ length: 6 }, (_, i) => ({ data: [i], nextCursor: String(i + 1) }));
    const client: PersistedClient = {
      timestamp: 1,
      buster: 'b',
      clientState: {
        mutations: [],
        queries: [
          query(['catalog', 'items'], 'success', {
            pages,
            pageParams: [undefined, '1', '2', '3', '4', '5'],
          }),
          query(['catalog', 'categories'], 'success', { data: [1, 2, 3] }),
        ],
      },
    };
    const [list, categories] = trimForStorage(client).clientState.queries;
    const trimmed = list!.state.data as { pages: unknown[]; pageParams: unknown[] };
    expect(trimmed.pages).toHaveLength(PERSISTED_PAGES_PER_LIST);
    expect(trimmed.pageParams).toEqual([undefined, '1', '2']);
    expect(categories!.state.data).toEqual({ data: [1, 2, 3] });
  });
});

describe('cacheBuster', () => {
  it('changes with the app version so stale caches are discarded after an update', () => {
    expect(cacheBuster('1.0.0')).not.toBe(cacheBuster('1.1.0'));
  });
});

describe('createQueryPersister', () => {
  afterEach(() => AsyncStorage.clear());

  it('round-trips a client through AsyncStorage, trimmed', async () => {
    const persister = createQueryPersister(AsyncStorage);
    const pages = Array.from({ length: 5 }, (_, i) => ({ data: [i] }));
    await persister.persistClient({
      timestamp: 1,
      buster: 'b',
      clientState: {
        mutations: [],
        queries: [query(['catalog', 'items'], 'success', { pages, pageParams: pages })],
      },
    });
    const stored = JSON.parse((await AsyncStorage.getItem(PERSIST_STORAGE_KEY))!);
    expect(stored.clientState.queries[0].state.data.pages).toHaveLength(PERSISTED_PAGES_PER_LIST);
    expect((await persister.restoreClient())?.buster).toBe('b');
  });
});
