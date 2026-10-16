import { ItemListResponseSchema, PAGE_SIZE_DEFAULT } from '@media-library/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from './helpers';

describe('GET /v1/items', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  it('returns the first page in the contract shape, newest first', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/items' });
    expect(res.statusCode).toBe(200);

    const body = ItemListResponseSchema.parse(res.json());
    expect(body.data).toHaveLength(PAGE_SIZE_DEFAULT);
    const createdAt = body.data.map((item) => item.createdAt);
    expect(createdAt).toEqual([...createdAt].sort().reverse());
  });

  it('never exposes the stream URL in the public catalog', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/items?limit=5' });
    for (const item of res.json().data) expect(item).not.toHaveProperty('streamUrl');
  });

  it('honours the limit parameter', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/v1/items?limit=3' });
    expect(res.json().data).toHaveLength(3);
  });

  it.each(['0', '51', 'abc', '2.5'])('rejects limit=%s with a validation error', async (limit) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/items?limit=${limit}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an empty page when the catalog is empty', async () => {
    const empty = await createTestApp({ withSeed: false });
    try {
      const res = await empty.app.inject({ method: 'GET', url: '/v1/items' });
      expect(res.json()).toEqual({ data: [], nextCursor: null });
    } finally {
      await empty.close();
    }
  });
});
