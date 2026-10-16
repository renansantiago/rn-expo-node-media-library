import { randomUUID } from 'node:crypto';
import {
  ItemListResponseSchema,
  LoginResponseSchema,
  PlaybackResponseSchema,
  ProgressBatchResponseSchema,
  ProgressListResponseSchema,
  ProgressWriteResponseSchema,
} from '@media-library/contracts';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, PREMIUM_USER, TEST_PASSWORD, type TestContext } from './helpers';

/**
 * One user, two devices, end to end through the public API only:
 * log in on both → browse → get a playback grant → the phone watches offline while the tablet
 * watches online later → the phone reconnects and syncs → both converge on the tablet's position.
 */
describe('end-to-end: browse, play and resume across two devices', () => {
  let ctx: TestContext;
  const t0 = Date.parse('2026-06-01T12:00:00.000Z');
  let nowMs = t0;

  beforeAll(async () => {
    ctx = await createTestApp({ now: () => new Date(nowMs) });
  });
  afterAll(() => ctx.close());

  const json = async <T>(
    schema: { parse: (v: unknown) => T },
    request: InjectOptions,
    expectedStatus = 200,
  ) => {
    const res = await ctx.app.inject(request);
    expect(res.statusCode, res.body).toBe(expectedStatus);
    return schema.parse(res.json());
  };

  it('converges on the most recent observation', async () => {
    const login = () =>
      json(LoginResponseSchema, {
        method: 'POST',
        url: '/v1/auth/login',
        payload: { username: PREMIUM_USER, password: TEST_PASSWORD },
      });
    const phone = (await login()).token;
    const tablet = (await login()).token;
    expect(phone).not.toBe(tablet);

    // Browse: first page, then follow the cursor.
    const page1 = await json(ItemListResponseSchema, { method: 'GET', url: '/v1/items?limit=5' });
    const page2 = await json(ItemListResponseSchema, {
      method: 'GET',
      url: `/v1/items?limit=5&cursor=${page1.nextCursor}`,
    });
    // A video long enough for the positions below (shorts would be clamped to their duration).
    const item = [...page1.data, ...page2.data].find((i) => i.durationSec >= 300)!;
    expect(item).toBeDefined();

    // Playback grant for an entitled user.
    const grant = await json(PlaybackResponseSchema, {
      method: 'GET',
      url: `/v1/items/${item.id}/playback`,
      headers: bearer(phone),
    });
    expect(grant.itemId).toBe(item.id);

    // 12:01 — the phone (offline) watches to 4:00; the event waits in its outbox.
    const phoneEvent = {
      eventId: randomUUID(),
      itemId: item.id,
      positionSec: 240,
      recordedAt: new Date(t0 + 60_000).toISOString(),
      deviceId: 'phone-0001',
    };

    // 12:05 — the tablet (online) watches the same item to 1:30.
    nowMs = t0 + 5 * 60_000;
    const tabletWrite = await json(ProgressWriteResponseSchema, {
      method: 'PUT',
      url: `/v1/me/progress/${item.id}`,
      headers: bearer(tablet),
      payload: {
        eventId: randomUUID(),
        positionSec: 90,
        recordedAt: new Date(nowMs).toISOString(),
        deviceId: 'tablet-0001',
      },
    });
    expect(tabletWrite.status).toBe('applied');

    // 12:30 — the phone reconnects and flushes; the response is lost, so it retries the batch.
    nowMs = t0 + 30 * 60_000;
    const flush = () =>
      json(ProgressBatchResponseSchema, {
        method: 'POST',
        url: '/v1/me/progress/batch',
        headers: bearer(phone),
        payload: { events: [phoneEvent] },
      });
    const first = await flush();
    const retry = await flush();
    expect(first.results[0]).toMatchObject({ status: 'stale', progress: { positionSec: 90 } });
    expect(retry.results[0]).toMatchObject({ status: 'duplicate', progress: { positionSec: 90 } });

    // Both devices now read the same canonical state: the tablet's later observation.
    for (const token of [phone, tablet]) {
      const { data } = await json(ProgressListResponseSchema, {
        method: 'GET',
        url: '/v1/me/progress',
        headers: bearer(token),
      });
      expect(data).toEqual([
        expect.objectContaining({ itemId: item.id, positionSec: 90, deviceId: 'tablet-0001' }),
      ]);
    }

    // Signing out one device revokes only that device's token.
    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(phone),
    });
    expect(logout.statusCode).toBe(204);
    const revoked = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/progress',
      headers: bearer(phone),
    });
    expect(revoked.statusCode).toBe(401);
    const stillIn = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/progress',
      headers: bearer(tablet),
    });
    expect(stillIn.statusCode).toBe(200);
  });
});
