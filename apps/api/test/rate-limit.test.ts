import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SharedMemoryStore } from '../src/plugins/rate-limit';
import {
  bearer,
  createTestApp,
  FREE_USER,
  PREMIUM_USER,
  TEST_PASSWORD,
  type TestContext,
} from './helpers';

const ITEM = '00000000-0000-4000-8000-000000000001';

describe('rate limiting', () => {
  let ctx: TestContext;
  afterEach(() => ctx.close());

  describe('POST /v1/auth/login', () => {
    const login = (username: string, password = 'wrong-password') =>
      ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });

    it('limits attempts per username and returns the error envelope with Retry-After', async () => {
      ctx = await createTestApp({ rateLimits: { loginMax: 3 } });
      for (let i = 0; i < 3; i++) expect((await login(FREE_USER)).statusCode).toBe(401);

      const limited = await login(FREE_USER, TEST_PASSWORD); // even the right password waits
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['x-ratelimit-limit']).toBe('3');
      expect(limited.headers['x-ratelimit-remaining']).toBe('0');
      expect(limited.json()).toMatchObject({
        error: { code: 'RATE_LIMITED', details: { retryAfterSec: expect.any(Number) } },
      });
      expect(limited.json().error.correlationId).toBe(limited.headers['x-correlation-id']);
    });

    it('does not lock out other accounts behind the same IP', async () => {
      ctx = await createTestApp({ rateLimits: { loginMax: 2 } });
      await login(FREE_USER);
      await login(FREE_USER);
      expect((await login(FREE_USER)).statusCode).toBe(429);
      expect((await login(PREMIUM_USER, TEST_PASSWORD)).statusCode).toBe(200);
    });

    it('treats usernames case-insensitively, so casing cannot bypass the limit', async () => {
      ctx = await createTestApp({ rateLimits: { loginMax: 2 } });
      await login('free-user');
      await login('FREE-USER');
      expect((await login('Free-User')).statusCode).toBe(429);
    });

    it('lets attempts through again once the window has passed', async () => {
      ctx = await createTestApp({ rateLimits: { loginMax: 1, windowSec: 1 } });
      await login(FREE_USER);
      expect((await login(FREE_USER)).statusCode).toBe(429);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect((await login(FREE_USER, TEST_PASSWORD)).statusCode).toBe(200);
    });
  });

  describe('progress writes', () => {
    const event = () => ({
      eventId: randomUUID(),
      positionSec: 10,
      recordedAt: new Date().toISOString(),
      deviceId: 'device-rate-limit',
    });
    const put = (token: string) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/v1/me/progress/${ITEM}`,
        headers: bearer(token),
        payload: event(),
      });
    const batch = (token: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/v1/me/progress/batch',
        headers: bearer(token),
        payload: { events: [{ ...event(), itemId: ITEM }] },
      });

    it('limits per user, across the single and batch endpoints', async () => {
      ctx = await createTestApp({ rateLimits: { writeMax: 2 } });
      const token = await ctx.login(FREE_USER);
      expect((await put(token)).statusCode).toBe(200);
      expect((await batch(token)).statusCode).toBe(200);
      const limited = await put(token);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      expect((await batch(token)).statusCode).toBe(429);

      // Another user has their own budget.
      expect((await put(await ctx.login(PREMIUM_USER))).statusCode).toBe(200);
    });

    it('never limits reads', async () => {
      ctx = await createTestApp({ rateLimits: { writeMax: 1 } });
      const token = await ctx.login(FREE_USER);
      await put(token);
      expect((await put(token)).statusCode).toBe(429);
      for (let i = 0; i < 5; i++) {
        const reads = await Promise.all([
          ctx.app.inject({ method: 'GET', url: '/v1/me/progress', headers: bearer(token) }),
          ctx.app.inject({ method: 'GET', url: '/v1/items' }),
        ]);
        expect(reads.map((r) => r.statusCode)).toEqual([200, 200]);
      }
    });

    it('authenticates before counting: anonymous writes get 401, not 429', async () => {
      ctx = await createTestApp({ rateLimits: { writeMax: 1 } });
      for (let i = 0; i < 3; i++) {
        const res = await ctx.app.inject({
          method: 'PUT',
          url: `/v1/me/progress/${ITEM}`,
          payload: event(),
        });
        expect(res.statusCode).toBe(401);
      }
    });

    it('shows up in metrics as 429s', async () => {
      ctx = await createTestApp({ rateLimits: { writeMax: 1 } });
      const token = await ctx.login(FREE_USER);
      await put(token);
      await put(token);
      const metrics = (await ctx.app.inject({ method: 'GET', url: '/metrics' })).body;
      expect(metrics).toContain(
        'http_requests_total{method="PUT",route="/v1/me/progress/:id",status_code="429"} 1',
      );
    });
  });
});

describe('SharedMemoryStore', () => {
  const incr = (store: SharedMemoryStore, key: string, windowMs = 1_000) =>
    new Promise<{ current: number; ttl: number }>((resolve) =>
      store.incr(key, (_err, result) => resolve(result!), windowMs),
    );
  const read = (store: SharedMemoryStore, key: string, windowMs = 1_000) =>
    new Promise<{ current: number; ttl: number }>((resolve) =>
      store.read(key, (_err, result) => resolve(result!), windowMs),
    );
  afterEach(() => vi.useRealTimers());

  it('counts per key within a fixed window and starts over after it', async () => {
    vi.useFakeTimers();
    const store = new SharedMemoryStore();
    expect((await incr(store, 'a')).current).toBe(1);
    expect((await incr(store, 'a')).current).toBe(2);
    expect((await incr(store, 'b')).current).toBe(1);
    expect(await read(store, 'a')).toMatchObject({ current: 2 });

    vi.advanceTimersByTime(1_000);
    expect(await read(store, 'a')).toEqual({ current: 0, ttl: 0 });
    expect((await incr(store, 'a')).current).toBe(1);
  });

  it('is shared by every route (child returns the same store)', () => {
    const store = new SharedMemoryStore();
    expect(store.child()).toBe(store);
  });

  it('stays bounded by evicting the least recently used key', async () => {
    const store = new SharedMemoryStore();
    for (let i = 0; i <= 10_000; i++) await incr(store, `key-${i}`);
    expect(await read(store, 'key-0')).toEqual({ current: 0, ttl: 0 });
    expect((await read(store, 'key-10000')).current).toBe(1);
  });
});
