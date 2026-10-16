import { categories, items } from './schema';
import { buildSeedItems, SEED_CATEGORIES } from './seed-data';
import type { Db } from './client';

/** Inserts the demo catalog. Safe to run repeatedly (existing rows are left untouched). */
export function seed(db: Db): { categories: number; items: number } {
  const seedItems = buildSeedItems();
  db.transaction((tx) => {
    tx.insert(categories).values(SEED_CATEGORIES).onConflictDoNothing().run();
    tx.insert(items).values(seedItems).onConflictDoNothing().run();
  });
  return { categories: SEED_CATEGORIES.length, items: seedItems.length };
}
