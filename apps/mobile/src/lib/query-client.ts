import { QueryClient } from '@tanstack/react-query';
import { HttpError, isRetryable } from './api/errors';
import { PERSIST_MAX_AGE_MS } from './query-persistence';

const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 10_000;

const serverWaitMs = (error: unknown) =>
  error instanceof HttpError ? error.retryAfterMs : undefined;

/**
 * Exponential backoff with full jitter, capped at 10s. When the server says how long to wait
 * (`Retry-After` on 429/503), that wins.
 */
export const retryDelay = (attempt: number, error?: unknown) =>
  serverWaitMs(error) ?? Math.random() * Math.min(MAX_RETRY_DELAY_MS, 500 * 2 ** attempt);

/**
 * Transient failures are retried a bounded number of times, unless the server asks for a longer
 * wait than a user should watch a spinner for: then the error (with Retry) is shown instead.
 */
export const shouldRetry = (failureCount: number, error: unknown) =>
  isRetryable(error) &&
  failureCount < MAX_RETRIES &&
  (serverWaitMs(error) ?? 0) <= MAX_RETRY_DELAY_MS;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        // Unused data must outlive the persisted cache's max age, or it would be dropped from disk
        // before it expires. User-scoped queries opt out with their own (short) gcTime.
        gcTime: PERSIST_MAX_AGE_MS,
        retry: shouldRetry,
        retryDelay,
      },
    },
  });
}
