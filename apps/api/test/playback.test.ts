import { canWatch, PlaybackResponseSchema } from '@media-library/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bearer, createTestApp, FREE_USER, PREMIUM_USER, type TestContext } from './helpers';

// Seed: item 1 "Big Buck Bunny" is free, item 3 "Meadow Mornings" is premium.
const FREE_ITEM = '00000000-0000-4000-8000-000000000001';
const PREMIUM_ITEM = '00000000-0000-4000-8000-000000000003';

describe('GET /v1/items/:id/playback', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  const playback = (itemId: string, token?: string) =>
    ctx.app.inject({
      method: 'GET',
      url: `/v1/items/${itemId}/playback`,
      headers: token ? bearer(token) : {},
    });

  it('requires authentication', async () => {
    const res = await playback(FREE_ITEM);
    expect(res.statusCode).toBe(401);
  });

  it('lets a free user play a free item, without caching', async () => {
    const res = await playback(FREE_ITEM, await ctx.login(FREE_USER));
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(PlaybackResponseSchema.parse(res.json())).toEqual({
      itemId: FREE_ITEM,
      streamUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    });
  });

  it('forbids a free user from playing a premium item', async () => {
    const res = await playback(PREMIUM_ITEM, await ctx.login(FREE_USER));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(res.body).not.toContain('http');
  });

  it('lets a premium user play premium and free items', async () => {
    const token = await ctx.login(PREMIUM_USER);
    expect((await playback(PREMIUM_ITEM, token)).statusCode).toBe(200);
    expect((await playback(FREE_ITEM, token)).statusCode).toBe(200);
  });

  it('returns 404 for unknown items and 400 for malformed ids', async () => {
    const token = await ctx.login();
    expect((await playback('00000000-0000-4000-8000-000000099999', token)).statusCode).toBe(404);
    expect((await playback('nope', token)).statusCode).toBe(400);
  });
});

describe('canWatch', () => {
  it.each([
    ['free', 'free', true],
    ['free', 'premium', false],
    ['premium', 'free', true],
    ['premium', 'premium', true],
  ] as const)('%s user, %s item → %s', (userTier, itemTier, expected) => {
    expect(canWatch(userTier, itemTier)).toBe(expected);
  });
});
