import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, paginatedSchema } from './pagination';

export const TierSchema = z.enum(['free', 'premium']);
export type Tier = z.infer<typeof TierSchema>;

export const CategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});
export type Category = z.infer<typeof CategorySchema>;

/** Public catalog item. The stream URL is intentionally not part of it (served by the playback endpoint). */
export const ItemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  category: CategorySchema,
  durationSec: z.number().int().nonnegative(),
  thumbnailUrl: z.url().nullable(),
  requiredTier: TierSchema,
  createdAt: z.iso.datetime(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ItemListResponseSchema = paginatedSchema(ItemSchema);
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;

export const CategorySlugSchema = z.string().regex(/^[a-z0-9-]{1,64}$/, 'Invalid category slug');

export const ListItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  /** Opaque keyset cursor returned as `nextCursor` by the previous page. */
  cursor: z.string().min(1).max(256).optional(),
  category: CategorySlugSchema.optional(),
});
export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;

export const ItemParamsSchema = z.object({ id: z.uuid() });
export type ItemParams = z.infer<typeof ItemParamsSchema>;

export const CategoryListResponseSchema = z.object({ data: z.array(CategorySchema) });
export type CategoryListResponse = z.infer<typeof CategoryListResponseSchema>;

/** Returned only to entitled users. Never cache: it is per-user and short-lived in production. */
export const PlaybackResponseSchema = z.object({
  itemId: z.uuid(),
  streamUrl: z.url(),
});
export type PlaybackResponse = z.infer<typeof PlaybackResponseSchema>;
