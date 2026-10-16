import type { CategoryRow, NewItemRow } from './schema';

/**
 * Publicly hosted sample streams (HLS + MP4). Several catalog items reuse the same stream:
 * the catalog is about metadata, entitlements and progress, not unique media.
 */
const STREAMS = {
  bigBuckBunny: { url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', durationSec: 635 },
  tearsOfSteel: { url: 'https://test-streams.mux.dev/tos_ismc/main.m3u8', durationSec: 734 },
  tearsOfSteelUsp: {
    url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    durationSec: 734,
  },
  bipbopAdvanced: {
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    durationSec: 600,
  },
  bipbop16x9: {
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8',
    durationSec: 1800,
  },
  bipbop4x3: {
    url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
    durationSec: 1800,
  },
  sintelTrailer: {
    url: 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
    durationSec: 52,
  },
} as const;

type StreamKey = keyof typeof STREAMS;

export const SEED_CATEGORIES: CategoryRow[] = [
  { id: 'cat-animation', slug: 'animation', name: 'Animation' },
  { id: 'cat-sci-fi', slug: 'sci-fi', name: 'Sci-Fi' },
  { id: 'cat-documentary', slug: 'documentary', name: 'Documentary' },
  { id: 'cat-tech', slug: 'tech', name: 'Tech Talks' },
  { id: 'cat-shorts', slug: 'shorts', name: 'Shorts' },
];

type SeedItem = [title: string, categoryId: string, stream: StreamKey, tier: 'free' | 'premium'];

const ITEMS: SeedItem[] = [
  ['Big Buck Bunny', 'cat-animation', 'bigBuckBunny', 'free'],
  ['Sintel', 'cat-animation', 'sintelTrailer', 'free'],
  ['Meadow Mornings', 'cat-animation', 'bigBuckBunny', 'premium'],
  ['The Last Acorn', 'cat-animation', 'bigBuckBunny', 'free'],
  ['Paper Kites', 'cat-animation', 'sintelTrailer', 'premium'],
  ['Clockwork Fox', 'cat-animation', 'bigBuckBunny', 'free'],
  ['Lanterns of Ember Bay', 'cat-animation', 'sintelTrailer', 'premium'],
  ['Pixel Garden', 'cat-animation', 'bigBuckBunny', 'free'],
  ['Tears of Steel', 'cat-sci-fi', 'tearsOfSteel', 'free'],
  ['Orbital Drift', 'cat-sci-fi', 'tearsOfSteelUsp', 'premium'],
  ['Signal from Kepler', 'cat-sci-fi', 'tearsOfSteel', 'premium'],
  ['Neon Harbor', 'cat-sci-fi', 'tearsOfSteelUsp', 'free'],
  ['The Quiet Machine', 'cat-sci-fi', 'tearsOfSteel', 'premium'],
  ['Red Dust Protocol', 'cat-sci-fi', 'tearsOfSteelUsp', 'free'],
  ['Event Horizon Diaries', 'cat-sci-fi', 'tearsOfSteel', 'premium'],
  ['Glass City', 'cat-sci-fi', 'tearsOfSteelUsp', 'free'],
  ['Rivers of the North', 'cat-documentary', 'bipbop16x9', 'free'],
  ['The Salt Road', 'cat-documentary', 'bipbop4x3', 'premium'],
  ['Inside the Hive', 'cat-documentary', 'bipbop16x9', 'free'],
  ['Night Shift at the Observatory', 'cat-documentary', 'bipbop4x3', 'premium'],
  ['Coral Cities', 'cat-documentary', 'bipbop16x9', 'free'],
  ['Mountain Rescue', 'cat-documentary', 'bipbop4x3', 'premium'],
  ['The Bread Makers', 'cat-documentary', 'bipbop16x9', 'free'],
  ['Desert Bloom', 'cat-documentary', 'bipbop4x3', 'premium'],
  ['Offline-First Mobile Apps', 'cat-tech', 'bipbopAdvanced', 'free'],
  ['Idempotency in Practice', 'cat-tech', 'bipbopAdvanced', 'premium'],
  ['Observability 101', 'cat-tech', 'bipbopAdvanced', 'free'],
  ['Designing Cursor Pagination', 'cat-tech', 'bipbopAdvanced', 'premium'],
  ['Clock Skew and You', 'cat-tech', 'bipbopAdvanced', 'free'],
  ['SQLite in Production?', 'cat-tech', 'bipbopAdvanced', 'premium'],
  ['Shipping React Native at Scale', 'cat-tech', 'bipbopAdvanced', 'free'],
  ['Retries Without Regret', 'cat-tech', 'bipbopAdvanced', 'premium'],
  ['One Minute Sunrise', 'cat-shorts', 'sintelTrailer', 'free'],
  ['Tiny Kitchen', 'cat-shorts', 'sintelTrailer', 'free'],
  ['Skate Loop', 'cat-shorts', 'sintelTrailer', 'premium'],
  ['Rain on Tin', 'cat-shorts', 'sintelTrailer', 'free'],
  ['Origami Minute', 'cat-shorts', 'sintelTrailer', 'premium'],
  ['Street Piano', 'cat-shorts', 'sintelTrailer', 'free'],
  ['Last Train Home', 'cat-shorts', 'sintelTrailer', 'premium'],
  ['Tidepool', 'cat-shorts', 'sintelTrailer', 'free'],
];

/** Stable UUIDs so item IDs survive a `db:reset` (handy for progress testing across devices). */
export const seedItemId = (index: number) =>
  `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;

const BASE_CREATED_AT = Date.UTC(2026, 0, 1);

export function buildSeedItems(): NewItemRow[] {
  return ITEMS.map(([title, categoryId, streamKey, tier], index) => {
    const stream = STREAMS[streamKey];
    const id = seedItemId(index);
    return {
      id,
      title,
      description: `${title} — a sample title from the media library seed catalog.`,
      categoryId,
      durationSec: stream.durationSec,
      thumbnailUrl: `https://picsum.photos/seed/${id}/640/360`,
      streamUrl: stream.url,
      requiredTier: tier,
      // One hour apart so ordering (newest first) is deterministic.
      createdAt: new Date(BASE_CREATED_AT + index * 60 * 60 * 1000),
    };
  });
}
