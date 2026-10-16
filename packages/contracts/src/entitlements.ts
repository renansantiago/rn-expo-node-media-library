import type { Tier } from './catalog';

const TIER_RANK: Record<Tier, number> = { free: 0, premium: 1 };

/**
 * A user can watch an item when their tier is at least the item's required tier.
 * The API enforces it; the app uses the same rule only to tailor the UI.
 */
export const canWatch = (userTier: Tier, requiredTier: Tier): boolean =>
  TIER_RANK[userTier] >= TIER_RANK[requiredTier];
