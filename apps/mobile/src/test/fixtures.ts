import type { Category, Item, LoginResponse, User } from '@media-library/contracts';

export const CATEGORIES: Category[] = [
  { id: 'cat-animation', slug: 'animation', name: 'Animation' },
  { id: 'cat-sci-fi', slug: 'sci-fi', name: 'Sci-Fi' },
];

export const itemId = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

export function makeItem(overrides: Partial<Item> = {}, index = 1): Item {
  return {
    id: itemId(index),
    title: `Item ${index}`,
    description: `Description ${index}`,
    category: CATEGORIES[0]!,
    durationSec: 635,
    thumbnailUrl: null,
    requiredTier: 'free',
    createdAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    ...overrides,
  };
}

export const makeItems = (count: number) =>
  Array.from({ length: count }, (_, i) => makeItem({}, i + 1));

/** 25 items, newest first; odd items are Animation, even are Sci-Fi; every 3rd is premium. */
export const CATALOG: Item[] = Array.from({ length: 25 }, (_, i) => {
  const index = 25 - i;
  return makeItem(
    {
      category: CATEGORIES[index % 2 === 1 ? 0 : 1]!,
      requiredTier: index % 3 === 0 ? 'premium' : 'free',
    },
    index,
  );
});

export const FREE_ITEM = CATALOG.find((i) => i.requiredTier === 'free')!;
export const PREMIUM_ITEM = CATALOG.find((i) => i.requiredTier === 'premium')!;

export const USERS: Record<'free' | 'premium', User> = {
  free: { id: 'user-free', username: 'free-user', displayName: 'Free Demo', tier: 'free' },
  premium: {
    id: 'user-premium',
    username: 'premium-user',
    displayName: 'Premium Demo',
    tier: 'premium',
  },
};

export const TEST_PASSWORD = 'secret';

export const makeSession = (
  tier: 'free' | 'premium',
  overrides: Partial<LoginResponse> = {},
): LoginResponse => ({
  token: `token-${tier}`,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  user: USERS[tier],
  ...overrides,
});
