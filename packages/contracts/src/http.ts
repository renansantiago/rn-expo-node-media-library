/** Header used to correlate a request across app logs, API logs and error responses. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Accepted shape for client-supplied correlation IDs (anything else is replaced server-side). */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
