import { QueryClient } from '@tanstack/react-query';
import { isRetryable } from './api/errors';

const MAX_RETRIES = 2;

/** Exponential backoff with full jitter, capped at 10s. */
export const retryDelay = (attempt: number) => Math.random() * Math.min(10_000, 500 * 2 ** attempt);

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        retry: (failureCount, error) => isRetryable(error) && failureCount < MAX_RETRIES,
        retryDelay,
      },
    },
  });
}
