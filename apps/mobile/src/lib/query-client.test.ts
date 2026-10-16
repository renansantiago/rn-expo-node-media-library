import { HttpError, NetworkError } from './api/errors';
import { createQueryClient, retryDelay } from './query-client';

describe('query client retry policy', () => {
  const retry = createQueryClient().getDefaultOptions().queries?.retry as (
    failureCount: number,
    error: unknown,
  ) => boolean;

  it('retries transient failures a bounded number of times', () => {
    expect(retry(0, new NetworkError('n', 'c'))).toBe(true);
    expect(retry(1, new NetworkError('n', 'c'))).toBe(true);
    expect(retry(2, new NetworkError('n', 'c'))).toBe(false);
  });

  it('does not retry client errors', () => {
    expect(retry(0, new HttpError(400, 'VALIDATION_ERROR', 'x', 'c'))).toBe(false);
  });

  it('uses capped, jittered exponential backoff', () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const delay = retryDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(Math.min(10_000, 500 * 2 ** attempt));
    }
  });

  it('honours a short Retry-After and gives up on a long one', () => {
    const shortWait = new HttpError(429, 'RATE_LIMITED', 'x', 'c', undefined, 3_000);
    const longWait = new HttpError(429, 'RATE_LIMITED', 'x', 'c', undefined, 60_000);
    expect(retry(0, shortWait)).toBe(true);
    expect(retryDelay(0, shortWait)).toBe(3_000);
    expect(retry(0, longWait)).toBe(false);
  });
});
