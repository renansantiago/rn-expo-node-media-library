import { CORRELATION_ID_HEADER } from '@media-library/contracts';
import { z } from 'zod';
import { createLogger, type LogEntry } from '../logger';
import { createApiClient } from './client';
import { HttpError, InvalidResponseError, NetworkError, TimeoutError } from './errors';

const Schema = z.object({ ok: z.boolean() });

function setup(fetchFn: typeof fetch, timeoutMs = 1_000) {
  const entries: LogEntry[] = [];
  const client = createApiClient({
    baseUrl: 'http://api.test',
    timeoutMs,
    fetchFn,
    newCorrelationId: () => 'corr-0001',
    logger: createLogger({ minLevel: 'debug', sink: (e) => entries.push(e) }),
  });
  return { client, entries };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fetch that only settles when its signal aborts (simulates a hung server), like real fetch. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (init?.signal?.aborted) return abort();
    init?.signal?.addEventListener('abort', abort);
  });

describe('createApiClient', () => {
  it('sends the correlation ID, encodes the query and validates the response', async () => {
    const fetchFn = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json({ ok: true }),
    );
    const { client, entries } = setup(fetchFn);

    await expect(
      client.request({
        path: '/v1/x',
        query: { limit: 5, q: 'a b', skip: undefined },
        schema: Schema,
      }),
    ).resolves.toEqual({ ok: true });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://api.test/v1/x?limit=5&q=a%20b');
    expect((init?.headers as Record<string, string>)[CORRELATION_ID_HEADER]).toBe('corr-0001');
    expect(entries.at(-1)).toMatchObject({
      event: 'http.response',
      correlationId: 'corr-0001',
      status: 200,
    });
  });

  it('serialises JSON bodies with a content type', async () => {
    const fetchFn = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      json({ ok: true }),
    );
    const { client } = setup(fetchFn);
    await client.request({ method: 'POST', path: '/v1/x', body: { a: 1 }, schema: Schema });

    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.body).toBe('{"a":1}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('times out hung requests with a TimeoutError', async () => {
    const { client, entries } = setup(hangingFetch, 20);
    const error = await client.request({ path: '/slow', schema: Schema }).catch((e) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.correlationId).toBe('corr-0001');
    expect(entries.at(-1)).toMatchObject({ event: 'http.error', kind: 'timeout', level: 'warn' });
  });

  it('maps transport failures to NetworkError', async () => {
    const { client } = setup(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(client.request({ path: '/x', schema: Schema })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it('propagates caller cancellation untouched (not reported as a failure)', async () => {
    const { client, entries } = setup(hangingFetch);
    const controller = new AbortController();
    const pending = client.request({ path: '/x', schema: Schema, signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e) => e);
    expect(error).not.toBeInstanceOf(TimeoutError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(entries.find((e) => e.event === 'http.error')).toBeUndefined();
  });

  it('honours an already-aborted signal', async () => {
    const { client } = setup(hangingFetch);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.request({ path: '/x', schema: Schema, signal: controller.signal }),
    ).rejects.toBeDefined();
  });

  it('parses the API error envelope into an HttpError (server correlation ID wins)', async () => {
    const { client } = setup(async () =>
      json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'bad limit',
            correlationId: 'srv-123',
            details: [1],
          },
        },
        400,
      ),
    );
    const error = await client.request({ path: '/x', schema: Schema }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'bad limit',
      correlationId: 'srv-123',
      details: [1],
    });
  });

  it('handles non-JSON error bodies (e.g. a proxy 502 page)', async () => {
    const { client } = setup(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    const error = await client.request({ path: '/x', schema: Schema }).catch((e) => e);
    expect(error).toMatchObject({ status: 502, code: 'UNKNOWN', correlationId: 'corr-0001' });
  });

  it('rejects 2xx responses that violate the contract', async () => {
    const { client } = setup(async () => json({ ok: 'yes' }));
    await expect(client.request({ path: '/x', schema: Schema })).rejects.toBeInstanceOf(
      InvalidResponseError,
    );
  });

  it('rejects empty 2xx bodies when the schema expects data', async () => {
    const { client } = setup(async () => new Response('', { status: 200 }));
    await expect(client.request({ path: '/x', schema: Schema })).rejects.toBeInstanceOf(
      InvalidResponseError,
    );
  });

  describe('authentication', () => {
    const okFetch = () =>
      jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true }));

    function authClient(fetchFn: typeof fetch, token: string | null, onUnauthorized = jest.fn()) {
      const client = createApiClient({
        baseUrl: 'http://api.test',
        timeoutMs: 1_000,
        fetchFn,
        logger: createLogger({ minLevel: 'silent' }),
        getAuthToken: () => token,
        onUnauthorized,
      });
      return { client, onUnauthorized };
    }

    it('attaches the bearer token when present', async () => {
      const fetchFn = okFetch();
      await authClient(fetchFn, 'tok-123').client.request({ path: '/x', schema: Schema });
      const headers = fetchFn.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok-123');
    });

    it('omits the header when signed out', async () => {
      const fetchFn = okFetch();
      await authClient(fetchFn, null).client.request({ path: '/x', schema: Schema });
      const headers = fetchFn.mock.calls[0]![1]!.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('reports a rejected token on 401', async () => {
      const unauthorized = async () =>
        json({ error: { code: 'UNAUTHORIZED', message: 'expired', correlationId: 'c' } }, 401);
      const { client, onUnauthorized } = authClient(unauthorized, 'tok-123');
      await expect(client.request({ path: '/x', schema: Schema })).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(onUnauthorized).toHaveBeenCalledWith('tok-123');
    });

    it('does not report 401s for anonymous requests', async () => {
      const unauthorized = async () =>
        json({ error: { code: 'UNAUTHORIZED', message: 'nope', correlationId: 'c' } }, 401);
      const { client, onUnauthorized } = authClient(unauthorized, null);
      await expect(client.request({ path: '/x', schema: Schema })).rejects.toBeInstanceOf(
        HttpError,
      );
      expect(onUnauthorized).not.toHaveBeenCalled();
    });
  });
});
