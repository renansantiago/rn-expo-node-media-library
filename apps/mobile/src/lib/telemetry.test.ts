import { http, HttpResponse } from 'msw';
import { z } from 'zod';
import { server, TEST_API_URL } from '../test/server';
import { createApiClient } from './api';
import { createLogger } from './logger';
import { createRequestMetrics, normalizeRoute, type RequestMetric } from './telemetry';

const metric = (overrides: Partial<RequestMetric> = {}): RequestMetric => ({
  method: 'GET',
  route: '/v1/items',
  status: 200,
  outcome: 'success',
  durationMs: 10,
  ...overrides,
});

describe('normalizeRoute', () => {
  it('replaces ids so they never become metric labels', () => {
    expect(normalizeRoute('/v1/items/00000000-0000-4000-8000-000000000001/playback')).toBe(
      '/v1/items/:id/playback',
    );
    expect(normalizeRoute('/v1/items')).toBe('/v1/items');
  });
});

describe('createRequestMetrics', () => {
  it('aggregates count, error rate and latency percentiles per route', () => {
    const metrics = createRequestMetrics();
    for (let ms = 1; ms <= 100; ms++) metrics.record(metric({ durationMs: ms }));
    metrics.record(
      metric({ route: '/v1/me', status: null, outcome: 'timeout', durationMs: 10_000 }),
    );

    const snapshot = metrics.snapshot();
    expect(snapshot.total).toBe(101);
    expect(snapshot.errors).toBe(1);
    expect(snapshot.errorRate).toBeCloseTo(1 / 101);
    expect(snapshot.byRoute['GET /v1/items']).toEqual({
      count: 100,
      errors: 0,
      p50Ms: 51,
      p95Ms: 96,
    });
    expect(snapshot.byRoute['GET /v1/me']).toMatchObject({ count: 1, errors: 1, p95Ms: 10_000 });
  });

  it('keeps a bounded latency window so memory stays constant', () => {
    const metrics = createRequestMetrics({ window: 10 });
    for (let i = 0; i < 1_000; i++) metrics.record(metric({ durationMs: i < 990 ? 1 : 500 }));
    expect(metrics.snapshot().byRoute['GET /v1/items']).toMatchObject({ count: 1_000, p50Ms: 500 });
  });

  it('starts empty and can be reset', () => {
    const metrics = createRequestMetrics();
    expect(metrics.snapshot()).toEqual({ total: 0, errors: 0, errorRate: 0, byRoute: {} });
    metrics.record(metric());
    metrics.reset();
    expect(metrics.snapshot().total).toBe(0);
  });
});

describe('API client → metrics', () => {
  it('reports every request once, with outcome, status and a route template', async () => {
    const metrics = createRequestMetrics();
    const client = createApiClient({
      baseUrl: TEST_API_URL,
      timeoutMs: 100,
      logger: createLogger({ minLevel: 'silent' }),
      onRequestComplete: metrics.record,
    });
    const id = '00000000-0000-4000-8000-000000000001';
    server.use(
      http.get(`${TEST_API_URL}/ok/${id}`, () => HttpResponse.json({ ok: true })),
      http.get(`${TEST_API_URL}/boom`, () => HttpResponse.json({}, { status: 500 })),
      http.get(`${TEST_API_URL}/bad`, () => HttpResponse.json({ ok: 'nope' })),
      http.get(`${TEST_API_URL}/down`, () => HttpResponse.error()),
    );
    const schema = z.object({ ok: z.boolean() });

    await client.request({ path: `/ok/${id}`, schema });
    await client.request({ path: '/boom', schema }).catch(() => undefined);
    await client.request({ path: '/bad', schema }).catch(() => undefined);
    await client.request({ path: '/down', schema }).catch(() => undefined);

    const { byRoute, total, errors } = metrics.snapshot();
    expect(total).toBe(4);
    expect(errors).toBe(3);
    expect(Object.keys(byRoute).sort()).toEqual([
      'GET /bad',
      'GET /boom',
      'GET /down',
      'GET /ok/:id',
    ]);
  });
});
