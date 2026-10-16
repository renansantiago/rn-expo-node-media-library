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
});
