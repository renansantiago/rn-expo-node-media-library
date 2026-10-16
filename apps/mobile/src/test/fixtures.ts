import type { Item } from '@media-library/contracts';

export function makeItem(overrides: Partial<Item> = {}, index = 1): Item {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Item ${index}`,
    description: `Description ${index}`,
    category: { id: 'cat-animation', slug: 'animation', name: 'Animation' },
    durationSec: 635,
    thumbnailUrl: null,
    requiredTier: 'free',
    createdAt: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
    ...overrides,
  };
}

export const makeItems = (count: number) =>
  Array.from({ length: count }, (_, i) => makeItem({}, i + 1));
