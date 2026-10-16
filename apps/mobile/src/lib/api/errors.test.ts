import {
  HttpError,
  InvalidResponseError,
  isRetryable,
  NetworkError,
  parseRetryAfter,
  TimeoutError,
} from './errors';

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

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-06-01T12:00:00Z');
  it.each([
    ['30', 30_000],
    ['0', 0],
    ['Mon, 01 Jun 2026 12:00:45 GMT', 45_000],
    ['Mon, 01 Jun 2026 11:00:00 GMT', 0], // in the past → no wait
    ['soon', undefined],
    [null, undefined],
  ])('%s → %s ms', (header, expected) => {
    expect(parseRetryAfter(header, now)).toBe(expected);
  });
});
