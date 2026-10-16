import { hashPassword } from '../lib/passwords';
import type { Db } from './client';
import { categories, items, users } from './schema';
import { buildSeedItems, SEED_CATEGORIES, SEED_USERS } from './seed-data';

export interface SeedOptions {
  /** Password for every demo user. Comes from configuration, never from source code. */
  demoPassword: string;
}

/** Inserts the demo catalog and users. Safe to run repeatedly (existing rows are left untouched). */
export async function seed(db: Db, { demoPassword }: SeedOptions) {
  const seedItems = buildSeedItems();
  const createdAt = new Date();
  const seedUsers = await Promise.all(
    SEED_USERS.map(async (user) => ({
      ...user,
      passwordHash: await hashPassword(demoPassword),
      createdAt,
    })),
  );

  db.transaction((tx) => {
    tx.insert(categories).values(SEED_CATEGORIES).onConflictDoNothing().run();
    tx.insert(items).values(seedItems).onConflictDoNothing().run();
    tx.insert(users).values(seedUsers).onConflictDoNothing().run();
  });

  return { categories: SEED_CATEGORIES.length, items: seedItems.length, users: seedUsers.length };
}
