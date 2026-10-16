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

export const ListItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type ListItemsQuery = z.infer<typeof ListItemsQuerySchema>;
