import type { Item } from '@media-library/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { categories, items, type CategoryRow, type ItemRow } from '../../db/schema';

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

export function createCatalogRepository(db: Db) {
  return {
    /** Newest first; `id` breaks ties so the order is total (required for keyset pagination). */
    listItems({ limit }: { limit: number }): Item[] {
      return db
        .select({ item: items, category: categories })
        .from(items)
        .innerJoin(categories, eq(items.categoryId, categories.id))
        .orderBy(desc(items.createdAt), desc(items.id))
        .limit(limit)
        .all()
        .map(({ item, category }) => toItem(item, category));
    },
  };
}

export type CatalogRepository = ReturnType<typeof createCatalogRepository>;
