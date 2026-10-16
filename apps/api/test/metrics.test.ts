import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createTestApp, type TestContext } from './helpers';

const ITEM = '00000000-0000-4000-8000-000000000001';

describe('GET /metrics', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  const scrape = async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    return res.body;
  };

  /** Value of one sample line, e.g. `http_requests_total{method="GET",...}`. */
  const sample = (body: string, name: string, labels: Record<string, string>) => {
    const rendered = Object.entries(labels)
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
    const line = body.split('\n').find((l) => l.startsWith(`${name}{${rendered}}`));
    return line ? Number(line.split(' ').at(-1)) : undefined;
  };

  it('counts requests by method, route template and status code', async () => {
    await ctx.app.inject({ method: 'GET', url: '/v1/items?limit=2' });
    await ctx.app.inject({ method: 'GET', url: '/v1/items?limit=2' });
    await ctx.app.inject({ method: 'GET', url: `/v1/items/${ITEM}` });
    await ctx.app.inject({ method: 'GET', url: '/v1/items/00000000-0000-4000-8000-000000099999' });
    await ctx.app.inject({ method: 'GET', url: '/v1/items?limit=999' });

    const body = await scrape();
    const labels = (route: string, status: number) => ({
      method: 'GET',
      route,
      status_code: String(status),
    });
    expect(sample(body, 'http_requests_total', labels('/v1/items', 200))).toBe(2);
    expect(sample(body, 'http_requests_total', labels('/v1/items', 400))).toBe(1);
    expect(sample(body, 'http_requests_total', labels('/v1/items/:id', 200))).toBe(1);
    expect(sample(body, 'http_requests_total', labels('/v1/items/:id', 404))).toBe(1);
    // Raw ids never become label values (bounded cardinality).
    expect(body).not.toContain(ITEM);
  });

  it('records latency in a histogram with the same labels', async () => {
    await ctx.app.inject({ method: 'GET', url: '/health' });
    const body = await scrape();
    const labels = { method: 'GET', route: '/health', status_code: '200' };
    expect(sample(body, 'http_request_duration_seconds_count', labels)).toBe(1);
    expect(sample(body, 'http_request_duration_seconds_bucket', { le: '+Inf', ...labels })).toBe(1);
    expect(sample(body, 'http_request_duration_seconds_sum', labels)).toBeGreaterThan(0);
  });

  it('labels unknown routes without leaking the requested path', async () => {
    await ctx.app.inject({ method: 'GET', url: '/nope/secret-path' });
    const body = await scrape();
    expect(
      sample(body, 'http_requests_total', {
        method: 'GET',
        route: 'unmatched',
        status_code: '404',
      }),
    ).toBe(1);
    expect(body).not.toContain('secret-path');
  });

  it('counts progress events by outcome', async () => {
    const token = await ctx.login();
    const event = {
      eventId: randomUUID(),
      positionSec: 10,
      recordedAt: new Date().toISOString(),
      deviceId: 'device-metrics',
    };
    const put = (body: object, itemId = ITEM) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/v1/me/progress/${itemId}`,
        headers: bearer(token),
        payload: body,
      });
    await put(event);
    await put(event); // duplicate
    await put({ ...event, eventId: randomUUID() }, '00000000-0000-4000-8000-000000000003'); // premium → rejected

    const body = await scrape();
    expect(sample(body, 'progress_events_total', { outcome: 'applied' })).toBe(1);
    expect(sample(body, 'progress_events_total', { outcome: 'duplicate' })).toBe(1);
    expect(sample(body, 'progress_events_total', { outcome: 'rejected' })).toBe(1);
  });

  it('exposes process metrics and does not count its own scrapes', async () => {
    await scrape();
    const body = await scrape();
    expect(body).toContain('process_cpu_seconds_total');
    expect(body).not.toContain('route="/metrics"');
  });
});
