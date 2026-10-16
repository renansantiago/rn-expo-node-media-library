import {
  ItemListResponseSchema,
  ItemSchema,
  PAGE_SIZE_DEFAULT,
  type Item,
} from '@media-library/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeCursor } from '../src/modules/catalog/cursor';
import { items } from '../src/db/schema';
import { createTestApp, type TestContext } from './helpers';

const SEEDED_ITEMS = 40;

describe('catalog', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await createTestApp();
  });
  afterEach(() => ctx.close());

  async function getPage(query: string) {
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/items${query}` });
    expect(res.statusCode).toBe(200);
    return ItemListResponseSchema.parse(res.json());
  }

  async function collectAll(params: string) {
    const all: Item[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const sep = params ? '&' : '';
      const page = await getPage(`?${params}${cursor ? `${sep}cursor=${cursor}` : ''}`);
      all.push(...page.data);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 100);
    return { all, pages };
  }

  describe('GET /v1/items', () => {
    it('returns the first page in the contract shape, newest first, with a next cursor', async () => {
      const body = await getPage('');
      expect(body.data).toHaveLength(PAGE_SIZE_DEFAULT);
      expect(body.nextCursor).toEqual(expect.any(String));
      const createdAt = body.data.map((item) => item.createdAt);
      expect(createdAt).toEqual([...createdAt].sort().reverse());
    });

    it('walks every item exactly once across pages', async () => {
      const { all, pages } = await collectAll('limit=7');
      expect(pages).toBe(Math.ceil(SEEDED_ITEMS / 7));
      expect(all).toHaveLength(SEEDED_ITEMS);
      expect(new Set(all.map((i) => i.id)).size).toBe(SEEDED_ITEMS);
    });

    it('returns a null cursor on the last page (exact multiple of the page size)', async () => {
      const { all, pages } = await collectAll('limit=20');
      expect(pages).toBe(2);
      expect(all).toHaveLength(SEEDED_ITEMS);
    });

    it('keeps pages stable when items share the same timestamp (id breaks ties)', async () => {
      const sameTime = new Date(Date.UTC(2030, 0, 1));
      ctx.handle.db.update(items).set({ createdAt: sameTime }).run();
      const { all } = await collectAll('limit=6');
      expect(all).toHaveLength(SEEDED_ITEMS);
      expect(new Set(all.map((i) => i.id)).size).toBe(SEEDED_ITEMS);
    });

    it('does not skip or repeat items when new items are inserted between pages', async () => {
      const first = await getPage('?limit=10');
      ctx.handle.db
        .insert(items)
        .values({
          id: '00000000-0000-4000-8000-000000009999',
          title: 'Brand new',
          description: '',
          categoryId: 'cat-tech',
          durationSec: 10,
          streamUrl: 'https://example.com/new.m3u8',
          createdAt: new Date(Date.UTC(2031, 0, 1)),
        })
        .run();
      const second = await getPage(`?limit=10&cursor=${first.nextCursor}`);
      const ids = [...first.data, ...second.data].map((i) => i.id);
      expect(new Set(ids).size).toBe(20);
      expect(ids).not.toContain('00000000-0000-4000-8000-000000009999');
    });

    it('filters by category and paginates within it', async () => {
      const { all } = await collectAll('category=sci-fi&limit=3');
      expect(all).toHaveLength(8);
      expect(all.every((item) => item.category.slug === 'sci-fi')).toBe(true);
    });

    it('returns an empty page for an unknown category', async () => {
      expect(await getPage('?category=unknown')).toEqual({ data: [], nextCursor: null });
    });

    it('never exposes the stream URL in the public catalog', async () => {
      const body = await getPage('?limit=5');
      for (const item of body.data) expect(item).not.toHaveProperty('streamUrl');
    });

    it.each(['0', '51', 'abc', '2.5'])(
      'rejects limit=%s with a validation error',
      async (limit) => {
        const res = await ctx.app.inject({ method: 'GET', url: `/v1/items?limit=${limit}` });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('VALIDATION_ERROR');
      },
    );

    it.each([
      ['garbage', 'not-base64-json'],
      ['wrong shape', Buffer.from(JSON.stringify({ foo: 1 })).toString('base64url')],
      ['negative time', encodeCursor({ createdAt: -1, id: 'x' })],
    ])('rejects a malformed cursor (%s)', async (_label, cursor) => {
      const res = await ctx.app.inject({ method: 'GET', url: `/v1/items?cursor=${cursor}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid cursor',
      });
    });

    it('rejects an invalid category slug', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/items?category=DROP%20TABLE' });
      expect(res.statusCode).toBe(400);
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

  describe('GET /v1/items/:id', () => {
    it('returns the item metadata and duration', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/items/00000000-0000-4000-8000-000000000001',
      });
      expect(res.statusCode).toBe(200);
      const item = ItemSchema.parse(res.json());
      expect(item).toMatchObject({ title: 'Big Buck Bunny', durationSec: 635 });
      expect(res.json()).not.toHaveProperty('streamUrl');
    });

    it('returns 404 for an unknown item', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/v1/items/00000000-0000-4000-8000-000000099999',
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('NOT_FOUND');
    });

    it('returns 400 for a malformed id', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/items/not-a-uuid' });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /v1/categories', () => {
    it('lists categories alphabetically', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/categories' });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((c: { slug: string }) => c.slug)).toEqual([
        'animation',
        'documentary',
        'sci-fi',
        'shorts',
        'tech',
      ]);
    });
  });
});
