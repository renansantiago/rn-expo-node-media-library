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

/** Finds an item already loaded by any catalog list, to render details instantly. */
function findCachedItem(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
): Item | undefined {
  const lists = queryClient.getQueriesData<InfiniteData<ItemListResponse>>({
    queryKey: catalogKeys.itemLists(),
  });
  for (const [, data] of lists) {
    for (const page of data?.pages ?? []) {
      const match = page.data.find((item) => item.id === id);
      if (match) return match;
    }
  }
  return undefined;
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
