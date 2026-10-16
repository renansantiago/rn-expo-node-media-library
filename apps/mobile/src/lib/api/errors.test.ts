import { HttpError, InvalidResponseError, isRetryable, NetworkError, TimeoutError } from './errors';

describe('isRetryable', () => {
  it.each([
    [new TimeoutError('t', 'c'), true],
    [new NetworkError('n', 'c'), true],
    [new HttpError(500, 'INTERNAL_ERROR', 'x', 'c'), true],
    [new HttpError(503, 'SERVICE_UNAVAILABLE', 'x', 'c'), true],
    [new HttpError(429, 'RATE_LIMITED', 'x', 'c'), true],
    [new HttpError(408, 'UNKNOWN', 'x', 'c'), true],
    [new HttpError(400, 'VALIDATION_ERROR', 'x', 'c'), false],
    [new HttpError(401, 'UNAUTHORIZED', 'x', 'c'), false],
    [new HttpError(404, 'NOT_FOUND', 'x', 'c'), false],
    [new InvalidResponseError('i', 'c'), false],
    [new Error('plain'), false],
  ])('%s → %s', (error, expected) => {
    expect(isRetryable(error)).toBe(expected);
  });
});
