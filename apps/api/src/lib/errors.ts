import type { ErrorCode } from '@media-library/contracts';

/** Expected, client-facing error. Anything else is treated as an internal error. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
