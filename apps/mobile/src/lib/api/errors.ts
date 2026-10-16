import type { ErrorCode } from '@media-library/contracts';

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'invalid_response';

/** Base class for every failure surfaced by the API client. Always carries the correlation ID. */
export abstract class ApiClientError extends Error {
  abstract readonly kind: ApiErrorKind;
  readonly correlationId: string;

  constructor(message: string, correlationId: string, options?: { cause?: unknown }) {
    super(message, options);
    this.correlationId = correlationId;
  }
}

export class TimeoutError extends ApiClientError {
  readonly kind = 'timeout';
  override name = 'TimeoutError';
}

export class NetworkError extends ApiClientError {
  readonly kind = 'network';
  override name = 'NetworkError';
}

export class InvalidResponseError extends ApiClientError {
  readonly kind = 'invalid_response';
  override name = 'InvalidResponseError';
}

export class HttpError extends ApiClientError {
  readonly kind = 'http';
  override name = 'HttpError';
  readonly status: number;
  readonly code: ErrorCode | 'UNKNOWN';
  readonly details?: unknown;

  constructor(
    status: number,
    code: ErrorCode | 'UNKNOWN',
    message: string,
    correlationId: string,
    details?: unknown,
  ) {
    super(message, correlationId);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Transient failures worth retrying; 4xx (other than 408/429) are not. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError || error instanceof NetworkError) return true;
  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  return false;
}
