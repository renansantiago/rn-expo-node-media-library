import type { Category, Item, Tier } from '@media-library/contracts';
import { and, asc, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { categories, items, type CategoryRow, type ItemRow } from '../../db/schema';
import type { CatalogCursor } from './cursor';

export function toItem(row: ItemRow, category: CategoryRow): Item {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: { id: category.id, slug: category.slug, name: category.name },
    durationSec: row.durationSec,
    thumbnailUrl: row.thumbnailUrl,
    requiredTier: row.requiredTier,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListItemsParams {
  limit: number;
  after?: CatalogCursor;
  categorySlug?: string;
}

export interface ItemWithStream {
  item: Item;
  streamUrl: string;
  requiredTier: Tier;
}

export function createCatalogRepository(db: Db) {
  const selectItems = () =>
    db
      .select({ item: items, category: categories })
      .from(items)
      .innerJoin(categories, eq(items.categoryId, categories.id));

  return {
    /**
     * Keyset pagination over (created_at DESC, id DESC): stable under concurrent inserts and
     * O(limit) per page thanks to the composite indexes, unlike OFFSET.
     * Returns up to `limit` items plus whether more exist.
     */
    listItems({ limit, after, categorySlug }: ListItemsParams): {
      items: Item[];
      hasMore: boolean;
    } {
      const conditions: SQL[] = [];
      if (categorySlug) conditions.push(eq(categories.slug, categorySlug));
      if (after) {
        const createdAt = new Date(after.createdAt);
        conditions.push(
          or(
            lt(items.createdAt, createdAt),
            and(eq(items.createdAt, createdAt), lt(items.id, after.id)),
          )!,
        );
      }

      const rows = selectItems()
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(items.createdAt), desc(items.id))
        .limit(limit + 1)
        .all();

      return {
        items: rows.slice(0, limit).map(({ item, category }) => toItem(item, category)),
        hasMore: rows.length > limit,
      };
    },

    findItem(id: string): ItemWithStream | undefined {
      const row = selectItems().where(eq(items.id, id)).get();
      if (!row) return undefined;
      return {
        item: toItem(row.item, row.category),
        streamUrl: row.item.streamUrl,
        requiredTier: row.item.requiredTier,
      };
    },

    listCategories(): Category[] {
      return db
        .select({ id: categories.id, slug: categories.slug, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name))
        .all();
    },
  };
}

export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
