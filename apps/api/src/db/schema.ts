import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    durationSec: integer('duration_sec').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    streamUrl: text('stream_url').notNull(),
    requiredTier: text('required_tier', { enum: ['free', 'premium'] })
      .notNull()
      .default('free'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    // Supports the catalog ordering (newest first) and the category filter with keyset pagination.
    index('items_created_at_id_idx').on(table.createdAt, table.id),
    index('items_category_created_at_id_idx').on(table.categoryId, table.createdAt, table.id),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  tier: text('tier', { enum: ['free', 'premium'] }).notNull(),
  /** `scrypt$<salt>$<hash>` (base64url). Plaintext passwords are never stored. */
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    /** SHA-256 of the opaque bearer token; a leaked DB does not leak usable tokens. */
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('auth_tokens_user_id_idx').on(table.userId),
    index('auth_tokens_expires_at_idx').on(table.expiresAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
