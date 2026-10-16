import { ApiErrorBodySchema, CORRELATION_ID_HEADER } from '@media-library/contracts';
import type { z } from 'zod';
import { newId } from '../ids';
import type { Logger } from '../logger';
import { HttpError, InvalidResponseError, NetworkError, TimeoutError } from './errors';

type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs: number;
  logger: Logger;
  fetchFn?: typeof fetch;
  newCorrelationId?: () => string;
  /** Bearer token to attach, read at request time. */
  getAuthToken?: () => string | null | undefined;
  /** Called with the rejected token when an authenticated request gets a 401 (expired/revoked). */
  onUnauthorized?: (token: string) => void;
}

export interface ApiClient {
  request<T>(options: RequestOptions<T>): Promise<T>;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const params = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return `${baseUrl}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

/**
 * Thin fetch wrapper: per-request correlation ID, hard timeout (covering headers and body),
 * typed errors, and runtime validation of every response against the shared contract.
 * Retries are left to the caller (TanStack Query / the sync outbox) so policy lives in one place.
 */
export function createApiClient({
  baseUrl,
  timeoutMs,
  logger,
  fetchFn = (...args) => fetch(...args),
  newCorrelationId = newId,
  getAuthToken,
  onUnauthorized,
}: ApiClientOptions): ApiClient {
  async function request<T>({
    method = 'GET',
    path,
    query,
    body,
    schema,
    signal,
    timeoutMs: requestTimeoutMs = timeoutMs,
  }: RequestOptions<T>): Promise<T> {
    const correlationId = newCorrelationId();
    const log = logger.child({ correlationId, method, path });
    const startedAt = Date.now();

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', onExternalAbort);

    const token = getAuthToken?.() ?? null;

    const fail = (error: Error & { kind: string }) => {
      log.warn('http.error', { kind: error.kind, durationMs: Date.now() - startedAt, err: error });
      return error;
    };

    try {
      let response: Response;
      let text: string;
      try {
        response = await fetchFn(buildUrl(baseUrl, path, query), {
          method,
          headers: {
            Accept: 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        text = await response.text();
      } catch (cause) {
        if (timedOut) {
          throw fail(
            new TimeoutError(`Request timed out after ${requestTimeoutMs}ms`, correlationId, {
              cause,
            }),
          );
        }
        // Caller cancelled (e.g. screen unmounted): propagate as-is, it is not a failure.
        if (signal?.aborted) throw cause;
        throw fail(new NetworkError('Network request failed', correlationId, { cause }));
      }

      let json: unknown = undefined;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
      }

      if (!response.ok) {
        if (response.status === 401 && token) onUnauthorized?.(token);
        const envelope = ApiErrorBodySchema.safeParse(json);
        throw fail(
          envelope.success
            ? new HttpError(
                response.status,
                envelope.data.error.code,
                envelope.data.error.message,
                envelope.data.error.correlationId,
                envelope.data.error.details,
              )
            : new HttpError(response.status, 'UNKNOWN', `HTTP ${response.status}`, correlationId),
        );
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw fail(
          new InvalidResponseError('Response did not match the expected contract', correlationId, {
            cause: parsed.error,
          }),
        );
      }

      log.debug('http.response', { status: response.status, durationMs: Date.now() - startedAt });
      return parsed.data;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  return { request };
}
