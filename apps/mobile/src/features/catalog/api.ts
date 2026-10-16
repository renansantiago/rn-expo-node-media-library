import {
  ItemListResponseSchema,
  PAGE_SIZE_DEFAULT,
  type ItemListResponse,
} from '@media-library/contracts';
import { useQuery } from '@tanstack/react-query';
import { useApiClient, type ApiClient } from '../../lib/api';

export const catalogKeys = {
  all: ['catalog'] as const,
  items: (params: { limit: number }) => [...catalogKeys.all, 'items', params] as const,
};

export function fetchItems(
  client: ApiClient,
  params: { limit: number },
  signal?: AbortSignal,
): Promise<ItemListResponse> {
  return client.request({
    path: '/v1/items',
    query: { limit: params.limit },
    schema: ItemListResponseSchema,
    signal,
  });
}

export function useCatalogItems(limit = PAGE_SIZE_DEFAULT) {
  const client = useApiClient();
  return useQuery({
    queryKey: catalogKeys.items({ limit }),
    queryFn: ({ signal }) => fetchItems(client, { limit }, signal),
  });
}
