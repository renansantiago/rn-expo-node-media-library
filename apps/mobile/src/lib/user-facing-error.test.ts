import { HttpError, InvalidResponseError, NetworkError, TimeoutError } from './api/errors';
import { toUserFacingError } from './user-facing-error';

describe('toUserFacingError', () => {
  it('adds a short correlation reference for API errors', () => {
    expect(toUserFacingError(new TimeoutError('t', '1234567890abcdef'))).toMatchObject({
      title: 'Taking too long',
      reference: '12345678',
    });
  });

  it.each([
    [new NetworkError('n', 'c'), "Can't reach the server"],
    [new InvalidResponseError('i', 'c'), 'Unexpected response'],
    [new HttpError(401, 'UNAUTHORIZED', 'x', 'c'), 'Sign in required'],
    [new HttpError(403, 'FORBIDDEN', 'x', 'c'), 'Not available'],
    [new HttpError(404, 'NOT_FOUND', 'x', 'c'), 'Not found'],
    [new HttpError(429, 'RATE_LIMITED', 'x', 'c'), 'Slow down'],
    [new HttpError(503, 'SERVICE_UNAVAILABLE', 'x', 'c'), 'Server problem'],
    [new HttpError(400, 'VALIDATION_ERROR', 'Limit too big', 'c'), 'Request failed'],
  ])('maps %s to "%s"', (error, title) => {
    expect(toUserFacingError(error).title).toBe(title);
  });

  it('never leaks raw messages from unknown errors', () => {
    const result = toUserFacingError(new Error('SQLITE_BUSY at /internal/path'));
    expect(result.title).toBe('Something went wrong');
    expect(result.message).not.toContain('SQLITE');
    expect(result.reference).toBeUndefined();
  });
});
