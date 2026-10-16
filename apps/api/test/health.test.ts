import { HealthResponseSchema, ReadyResponseSchema } from '@media-library/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from './helpers';

describe('health endpoints', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp({ withSeed: false });
  });
  afterEach(() => ctx.close());

  it('GET /health reports liveness', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponseSchema.parse(res.json()).status).toBe('ok');
  });

  it('GET /ready checks the database', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(ReadyResponseSchema.parse(res.json())).toEqual({
      status: 'ready',
      checks: { database: 'ok' },
    });
  });

  it('GET /ready returns 503 with the error envelope when the database is gone', async () => {
    ctx.handle.sqlite.close();
    const res = await ctx.app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
