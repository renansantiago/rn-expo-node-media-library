import {
  ProgressBatchResponseSchema,
  ProgressListResponseSchema,
  type ProgressEvent,
} from '@media-library/contracts';
import type { ApiClient } from '../../lib/api';

export const sendProgressBatch = (client: ApiClient, events: ProgressEvent[]) =>
  client.request({
    method: 'POST',
    path: '/v1/me/progress/batch',
    body: { events },
    schema: ProgressBatchResponseSchema,
  });

/** Progress for specific items, or the user's most recently watched items. */
export const fetchProgress = (
  client: ApiClient,
  { itemIds, limit }: { itemIds?: string[]; limit?: number } = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) =>
  client.request({
    path: '/v1/me/progress',
    query: { itemIds: itemIds?.join(','), limit },
    schema: ProgressListResponseSchema,
    ...options,
  });
