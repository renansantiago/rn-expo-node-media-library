import { ApiErrorBodySchema, CORRELATION_ID_HEADER } from '@media-library/contracts';
import { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from './helpers';

describe('error envelope and correlation IDs', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp({ withSeed: false });
  });
  afterEach(() => ctx.close());

  it('echoes a well-formed client correlation ID', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { [CORRELATION_ID_HEADER]: 'app-req-12345678' },
    });
    expect(res.headers[CORRELATION_ID_HEADER]).toBe('app-req-12345678');
  });

  it('replaces a malformed correlation ID with a generated one', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/health',
      headers: { [CORRELATION_ID_HEADER]: 'bad id\nwith newline' },
    });
    const id = res.headers[CORRELATION_ID_HEADER];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates a correlation ID when the client sends none', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns the envelope for unknown routes, carrying the correlation ID', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/nope',
      headers: { [CORRELATION_ID_HEADER]: 'trace-abcdef12' },
    });
    expect(res.statusCode).toBe(404);
    const body = ApiErrorBodySchema.parse(res.json());
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', correlationId: 'trace-abcdef12' });
  });

  it('hides internal details on unexpected errors', async () => {
    const withBoom = await createTestApp({
      withSeed: false,
      extend: (app) =>
        app.get('/boom', async () => {
          throw new Error('secret stack detail');
        }),
    });
    const res = await withBoom.app.inject({ method: 'GET', url: '/boom' });
    await withBoom.close();
    expect(res.statusCode).toBe(500);
    const body = ApiErrorBodySchema.parse(res.json());
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('maps malformed JSON bodies to a 400 envelope', async () => {
    const withPost = await createTestApp({
      withSeed: false,
      extend: (app) => app.post('/echo', async (request) => request.body),
    });
    const res = await withPost.app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    await withPost.close();
    expect(res.statusCode).toBe(400);
    expect(ApiErrorBodySchema.parse(res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses to send responses that violate the declared contract', async () => {
    const withBadRoute = await createTestApp({
      withSeed: false,
      extend: (app) =>
        app.get(
          '/bad-contract',
          { schema: { response: { 200: z.object({ id: z.uuid() }) } } },
          async () => ({ id: 'not-a-uuid' }),
        ),
    });
    const res = await withBadRoute.app.inject({ method: 'GET', url: '/bad-contract' });
    await withBadRoute.close();
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
  });
});
