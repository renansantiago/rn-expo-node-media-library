import { randomUUID } from 'node:crypto';
import {
  ProgressBatchResponseSchema,
  ProgressListResponseSchema,
  ProgressWriteResponseSchema,
  type ProgressEventFields,
} from '@media-library/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { progressEvents } from '../src/db/schema';
import { bearer, createTestApp, FREE_USER, PREMIUM_USER, type TestContext } from './helpers';

// Seed: item 1 (635s) and item 2 are free, item 3 is premium.
const ITEM = '00000000-0000-4000-8000-000000000001';
const OTHER_ITEM = '00000000-0000-4000-8000-000000000002';
const PREMIUM_ITEM = '00000000-0000-4000-8000-000000000003';
const UNKNOWN_ITEM = '00000000-0000-4000-8000-000000099999';
const DURATION = 635;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const at = (offsetSec: number) => new Date(NOW.getTime() + offsetSec * 1000).toISOString();

function event(overrides: Partial<ProgressEventFields> = {}): ProgressEventFields {
  return {
    eventId: randomUUID(),
    positionSec: 42,
    recordedAt: at(-60),
    deviceId: 'device-a',
    ...overrides,
  };
}

describe('playback progress', () => {
  let ctx: TestContext;
  let token: string;

  beforeEach(async () => {
    ctx = await createTestApp({ now: () => NOW });
    token = await ctx.login(FREE_USER);
  });
  afterEach(() => ctx.close());

  const put = (body: unknown, itemId = ITEM, auth = token) =>
    ctx.app.inject({
      method: 'PUT',
      url: `/v1/me/progress/${itemId}`,
      headers: auth ? bearer(auth) : {},
      payload: body as object,
    });

  const batch = (events: unknown[], auth = token) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/me/progress/batch',
      headers: bearer(auth),
      payload: { events },
    });

  const list = (query = '', auth = token) =>
    ctx.app.inject({ method: 'GET', url: `/v1/me/progress${query}`, headers: bearer(auth) });

  const current = async (itemId = ITEM, auth = token) => {
    const res = await list(`?itemIds=${itemId}`, auth);
    return ProgressListResponseSchema.parse(res.json()).data[0];
  };

  describe('auth and validation', () => {
    it('requires a bearer token on every route', async () => {
      expect((await put(event(), ITEM, '')).statusCode).toBe(401);
      const unauthenticated = [
        ctx.app.inject({ method: 'GET', url: '/v1/me/progress' }),
        ctx.app.inject({
          method: 'POST',
          url: '/v1/me/progress/batch',
          payload: { events: [{ ...event(), itemId: ITEM }] },
        }),
      ];
      for (const res of await Promise.all(unauthenticated)) expect(res.statusCode).toBe(401);
    });

    it.each([
      ['a negative position', { positionSec: -1 }],
      ['a non-uuid eventId', { eventId: 'abc' }],
      ['a malformed deviceId', { deviceId: 'no spaces allowed' }],
      ['a non-ISO recordedAt', { recordedAt: 'yesterday' }],
    ])('rejects %s with 400', async (_label, overrides) => {
      const res = await put(event(overrides));
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for unknown items and 403 for items outside the plan', async () => {
      expect((await put(event(), UNKNOWN_ITEM)).statusCode).toBe(404);
      const forbidden = await put(event(), PREMIUM_ITEM);
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error.code).toBe('FORBIDDEN');
    });
  });

  describe('PUT /v1/me/progress/:id', () => {
    it('stores the first event and returns the canonical state, uncached', async () => {
      const res = await put(event({ positionSec: 120.5 }));
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(ProgressWriteResponseSchema.parse(res.json())).toEqual({
        status: 'applied',
        progress: {
          itemId: ITEM,
          positionSec: 120.5,
          durationSec: DURATION,
          completed: false,
          recordedAt: at(-60),
          deviceId: 'device-a',
          updatedAt: NOW.toISOString(),
        },
      });
    });

    it('is idempotent: a replayed eventId is acknowledged without being re-applied', async () => {
      const first = event({ positionSec: 100, recordedAt: at(-30) });
      await put(first);
      await put(event({ positionSec: 200, recordedAt: at(-20) }));

      // Same eventId again, even with a "newer" payload, must not change anything.
      const replay = await put({ ...first, positionSec: 999, recordedAt: at(-1) });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ status: 'duplicate', progress: { positionSec: 200 } });
      expect((await current())?.positionSec).toBe(200);
    });

    it('lets a newer observation win and ignores an older one that arrives late', async () => {
      await put(event({ positionSec: 300, recordedAt: at(-10) }));
      const late = await put(event({ positionSec: 50, recordedAt: at(-100) }));
      expect(late.json()).toMatchObject({
        status: 'stale',
        progress: { positionSec: 300, recordedAt: at(-10) },
      });
    });

    it('allows moving backwards when the user really rewound later', async () => {
      await put(event({ positionSec: 500, recordedAt: at(-100) }));
      const rewind = await put(event({ positionSec: 10, recordedAt: at(-10) }));
      expect(rewind.json()).toMatchObject({ status: 'applied', progress: { positionSec: 10 } });
    });

    it('breaks exact timestamp ties by the greater deviceId, whatever the arrival order', async () => {
      const a = event({ positionSec: 111, recordedAt: at(-5), deviceId: 'device-a' });
      const b = event({ positionSec: 222, recordedAt: at(-5), deviceId: 'device-b' });

      await put(b);
      expect((await put(a)).json().status).toBe('stale');
      expect((await current())?.deviceId).toBe('device-b');

      const otherUser = await ctx.login(PREMIUM_USER);
      await put(a, ITEM, otherUser);
      expect((await put(b, ITEM, otherUser)).json().status).toBe('applied');
      expect((await current(ITEM, otherUser))?.deviceId).toBe('device-b');
    });

    it('rejects events stamped too far ahead of the server clock (422), tolerating small skew', async () => {
      const skewed = await put(event({ recordedAt: at(6 * 60) }));
      expect(skewed.statusCode).toBe(422);
      expect(skewed.json().error.code).toBe('CLOCK_SKEW');
      expect(await current()).toBeUndefined();

      expect((await put(event({ recordedAt: at(4 * 60) }))).json().status).toBe('applied');
    });

    it('clamps the position to the duration and marks the item completed', async () => {
      const res = await put(event({ positionSec: 5_000 }));
      expect(res.json().progress).toMatchObject({ positionSec: DURATION, completed: true });
    });

    it('converges on the newest event under concurrent writes', async () => {
      const events = Array.from({ length: 30 }, (_, i) =>
        event({ positionSec: i * 10, recordedAt: at(-300 + ((i * 7) % 30)) }),
      );
      const responses = await Promise.all(events.map((e) => put(e)));
      expect(responses.every((r) => r.statusCode === 200)).toBe(true);

      const newest = events.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
      expect(await current()).toMatchObject({
        positionSec: newest.positionSec,
        recordedAt: newest.recordedAt,
      });
    });

    it('scopes idempotency per user: the same eventId from two users is two events', async () => {
      const shared = event();
      await put(shared);
      const other = await put(shared, ITEM, await ctx.login(PREMIUM_USER));
      expect(other.json().status).toBe('applied');
    });

    it('keeps an audit trail of every distinct event and how it resolved', async () => {
      await put(event({ recordedAt: at(-10) }));
      const old = event({ recordedAt: at(-50) });
      await put(old);
      await put(old);

      const rows = ctx.handle.db.select().from(progressEvents).all();
      expect(rows.map((r) => r.outcome).sort()).toEqual(['applied', 'stale']);
    });
  });

  describe('POST /v1/me/progress/batch', () => {
    it('resolves each event independently and in request order', async () => {
      const newer = { ...event({ positionSec: 300, recordedAt: at(-10) }), itemId: ITEM };
      const older = { ...event({ positionSec: 100, recordedAt: at(-90) }), itemId: ITEM };
      const premium = { ...event(), itemId: PREMIUM_ITEM };
      const unknown = { ...event(), itemId: UNKNOWN_ITEM };
      const skewed = { ...event({ recordedAt: at(3600) }), itemId: OTHER_ITEM };
      const other = { ...event({ positionSec: 7 }), itemId: OTHER_ITEM };

      const res = await batch([newer, older, newer, premium, unknown, skewed, other]);
      expect(res.statusCode).toBe(200);
      const { results } = ProgressBatchResponseSchema.parse(res.json());
      expect(results.map((r) => [r.eventId, r.status])).toEqual([
        [newer.eventId, 'applied'],
        [older.eventId, 'stale'],
        [newer.eventId, 'duplicate'],
        [premium.eventId, 'rejected'],
        [unknown.eventId, 'rejected'],
        [skewed.eventId, 'rejected'],
        [other.eventId, 'applied'],
      ]);
      expect(results.slice(3, 6).map((r) => r.status === 'rejected' && r.reason)).toEqual([
        'forbidden',
        'unknown_item',
        'clock_skew',
      ]);
      expect((await current())?.positionSec).toBe(300);
      expect((await current(OTHER_ITEM))?.positionSec).toBe(7);
    });

    it('is safe to retry as a whole after a lost response', async () => {
      const events = [
        { ...event({ positionSec: 10 }), itemId: ITEM },
        { ...event({ positionSec: 20 }), itemId: OTHER_ITEM },
      ];
      await batch(events);
      const retry = ProgressBatchResponseSchema.parse((await batch(events)).json());
      expect(retry.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    });

    it('rejects empty and oversized batches', async () => {
      expect((await batch([])).statusCode).toBe(400);
      const tooMany = Array.from({ length: 101 }, () => ({ ...event(), itemId: ITEM }));
      expect((await batch(tooMany)).statusCode).toBe(400);
    });
  });

  describe('GET /v1/me/progress', () => {
    it('lists the most recently watched items first, honouring the limit', async () => {
      await put(event({ recordedAt: at(-100) }), ITEM);
      await put(event({ recordedAt: at(-10) }), OTHER_ITEM);

      const all = ProgressListResponseSchema.parse((await list()).json()).data;
      expect(all.map((p) => p.itemId)).toEqual([OTHER_ITEM, ITEM]);

      const limited = ProgressListResponseSchema.parse((await list('?limit=1')).json()).data;
      expect(limited.map((p) => p.itemId)).toEqual([OTHER_ITEM]);
    });

    it('filters by item ids and never returns another user’s progress', async () => {
      await put(event(), ITEM);
      await put(event(), OTHER_ITEM);
      const filtered = await list(`?itemIds=${ITEM},${UNKNOWN_ITEM}`);
      expect(ProgressListResponseSchema.parse(filtered.json()).data.map((p) => p.itemId)).toEqual([
        ITEM,
      ]);

      const other = await list('', await ctx.login(PREMIUM_USER));
      expect(other.json().data).toEqual([]);
    });

    it('rejects malformed item ids', async () => {
      expect((await list('?itemIds=not-a-uuid')).statusCode).toBe(400);
      expect((await list('?itemIds=')).statusCode).toBe(400);
    });
  });

  it('two devices, one offline: the later observation wins once both have synced', async () => {
    // Phone watches offline up to 5:00 (queued), then the tablet watches online to 2:00 later on.
    const phoneOffline = {
      ...event({ positionSec: 300, recordedAt: at(-600), deviceId: 'phone-0001' }),
      itemId: ITEM,
    };
    const tablet = event({ positionSec: 120, recordedAt: at(-60), deviceId: 'tablet-0001' });

    expect((await put(tablet)).json().status).toBe('applied');
    // The phone reconnects and flushes its outbox; its older observation must not clobber the tablet.
    const flushed = ProgressBatchResponseSchema.parse((await batch([phoneOffline])).json());
    expect(flushed.results[0]).toMatchObject({
      status: 'stale',
      progress: { positionSec: 120, deviceId: 'tablet-0001' },
    });
  });
});
