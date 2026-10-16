import { QueryClient } from '@tanstack/react-query';
import { isRetryable } from './api/errors';
import { PERSIST_MAX_AGE_MS } from './query-persistence';

const MAX_RETRIES = 2;

/** Exponential backoff with full jitter, capped at 10s. */
export const retryDelay = (attempt: number) => Math.random() * Math.min(10_000, 500 * 2 ** attempt);

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        // Unused data must outlive the persisted cache's max age, or it would be dropped from disk
        // before it expires. User-scoped queries opt out with their own (short) gcTime.
        gcTime: PERSIST_MAX_AGE_MS,
        retry: (failureCount, error) => isRetryable(error) && failureCount < MAX_RETRIES,
        retryDelay,
      },
    },
  });
}
