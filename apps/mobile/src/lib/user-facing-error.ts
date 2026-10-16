import { ApiClientError, HttpError } from './api/errors';

export interface UserFacingError {
  title: string;
  message: string;
  /** Short correlation reference the user can quote to support (matches API logs). */
  reference?: string;
}

function describeHttpError(error: HttpError): Omit<UserFacingError, 'reference'> {
  if (error.status === 401)
    return { title: 'Sign in required', message: 'Please sign in and try again.' };
  if (error.status === 403)
    return { title: 'Not available', message: "Your plan doesn't include this content." };
  if (error.status === 404)
    return { title: 'Not found', message: 'This content is no longer available.' };
  if (error.status === 429)
    return { title: 'Slow down', message: 'Too many requests. Please wait a moment.' };
  if (error.status >= 500) {
    return {
      title: 'Server problem',
      message: 'Something went wrong on our side. Please try again.',
    };
  }
  return { title: 'Request failed', message: error.message };
}

function describe(error: ApiClientError): Omit<UserFacingError, 'reference'> {
  if (error instanceof HttpError) return describeHttpError(error);
  switch (error.kind) {
    case 'timeout':
      return {
        title: 'Taking too long',
        message: 'The server did not respond in time. Check your connection and try again.',
      };
    case 'network':
      return {
        title: "Can't reach the server",
        message: 'You may be offline or the server is unavailable.',
      };
    default:
      return {
        title: 'Unexpected response',
        message: 'The server sent data this app version does not understand.',
      };
  }
}

/** Shown when a request is paused because the device is offline and nothing is cached. */
export const OFFLINE_ERROR: UserFacingError = {
  title: "You're offline",
  message: 'Connect to the internet to load this. Anything you opened before is still available.',
};

/** Maps any thrown value to copy that is safe and useful to show the user. */
export function toUserFacingError(error: unknown): UserFacingError {
  if (!(error instanceof ApiClientError)) {
    return {
      title: 'Something went wrong',
      message: 'An unexpected error occurred. Please try again.',
    };
  }
  return { ...describe(error), reference: error.correlationId.slice(0, 8) };
}
