import {
  CategoryListResponseSchema,
  ItemListResponseSchema,
  ItemSchema,
  PAGE_SIZE_DEFAULT,
  type Item,
  type ItemListResponse,
} from '@media-library/contracts';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApiClient } from '../../lib/api';

export const catalogKeys = {
  all: ['catalog'] as const,
  categories: () => [...catalogKeys.all, 'categories'] as const,
  itemLists: () => [...catalogKeys.all, 'items'] as const,
  items: (params: { category: string | null; limit: number }) =>
    [...catalogKeys.itemLists(), params] as const,
  item: (id: string) => [...catalogKeys.all, 'item', id] as const,
};

export function useCategories() {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) =>
      client.request({ path: '/v1/categories', schema: CategoryListResponseSchema, signal }),
    select: (response) => response.data,
    staleTime: 60 * 60 * 1000,
  });
}

/** Cursor-paginated catalog, optionally filtered by category slug. */
export function useCatalogItems(category: string | null, limit = PAGE_SIZE_DEFAULT) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: catalogKeys.items({ category, limit }),
    queryFn: ({ pageParam, signal }) =>
      client.request({
        path: '/v1/items',
        query: { limit, cursor: pageParam, category },
        schema: ItemListResponseSchema,
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** Every item held by any cached catalog list (in memory or restored from disk), de-duplicated. */
function cachedItems(queryClient: ReturnType<typeof useQueryClient>): Map<string, Item> {
  const found = new Map<string, Item>();
  const lists = queryClient.getQueriesData<InfiniteData<ItemListResponse>>({
    queryKey: catalogKeys.itemLists(),
  });
  for (const [, data] of lists) {
    for (const page of data?.pages ?? []) {
      for (const item of page.data) found.set(item.id, item);
    }
  }
  return found;
}

/** Finds an item already loaded by any catalog list, to render details instantly. */
const findCachedItem = (queryClient: ReturnType<typeof useQueryClient>, id: string) =>
  cachedItems(queryClient).get(id);

/**
 * Items already cached by *other* lists that belong in this one, in catalog order (newest first).
 * Lets a category that was never opened still show something while it loads or when the server
 * is unreachable, e.g. Animation items saved from the "All" list.
 */
export function useCachedItemsFor(category: string | null, enabled: boolean): Item[] {
  const queryClient = useQueryClient();
  return useMemo(() => {
    if (!enabled) return [];
    return [...cachedItems(queryClient).values()]
      .filter((item) => !category || item.category.slug === category)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }, [category, enabled, queryClient]);
}

/**
 * The item as saved by a catalog list. `useItem` uses it as a placeholder while loading, but React
 * Query drops placeholders when the request fails; screens use this to keep showing saved details.
 */
export function useCachedItem(id: string, enabled: boolean): Item | undefined {
  const queryClient = useQueryClient();
  return useMemo(
    () => (enabled ? findCachedItem(queryClient, id) : undefined),
    [enabled, id, queryClient],
  );
}

export function useItem(id: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useQuery<Item>({
    queryKey: catalogKeys.item(id),
    queryFn: ({ signal }) =>
      client.request({ path: `/v1/items/${encodeURIComponent(id)}`, schema: ItemSchema, signal }),
    placeholderData: () => findCachedItem(queryClient, id),
  });
}
