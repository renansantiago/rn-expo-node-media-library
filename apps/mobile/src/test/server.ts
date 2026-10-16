import {
  ApiErrorBodySchema,
  CategoryListResponseSchema,
  isCompleted,
  isNewerObservation,
  ItemListResponseSchema,
  ItemSchema,
  LoginResponseSchema,
  MeResponseSchema,
  PlaybackResponseSchema,
  ProgressBatchRequestSchema,
  ProgressBatchResponseSchema,
  ProgressListResponseSchema,
  type ApiErrorBody,
  type Progress,
  type ProgressBatchResult,
} from '@media-library/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { z } from 'zod';
import { CATALOG, CATEGORIES, TEST_PASSWORD, USERS } from './fixtures';

export const TEST_API_URL = 'http://api.test';

/** Responses from the fake API that broke the shared contract; any entry fails the test. */
export const contractViolations: string[] = [];

/**
 * Every fake response goes through the same zod schema the real API serialises with, so the
 * fake cannot drift from the API: a mismatch is recorded and fails the test (see setup.ts).
 */
export function contract<T>(schema: z.ZodType<T>, body: T, init?: ResponseInit) {
  const result = schema.safeParse(body);
  if (!result.success) contractViolations.push(result.error.message);
  return HttpResponse.json(body as object, init);
}
const url = (path: string) => `${TEST_API_URL}${path}`;

export const apiError = (
  status: number,
  code: ApiErrorBody['error']['code'],
  message: string = code,
) =>
  contract<ApiErrorBody>(
    ApiErrorBodySchema,
    { error: { code, message, correlationId: 'server-corr-0001' } },
    { status },
  );

/** Tokens the fake API accepts (revocable through /logout). */
const validTokens = new Map<string, keyof typeof USERS>();
/** Server-side progress per user id, resolved with the same multi-device rule as the real API. */
export const fakeProgress = new Map<string, Map<string, Progress>>();
/** Every progress batch the fake API received (for asserting on what the app sent). */
export const receivedBatches: unknown[][] = [];

export function resetFakeApi() {
  contractViolations.length = 0;
  fakeProgress.clear();
  receivedBatches.length = 0;
  validTokens.clear();
  validTokens.set('token-free', 'free');
  validTokens.set('token-premium', 'premium');
}
resetFakeApi();

function currentUser(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
  const tier = token ? validTokens.get(token) : undefined;
  return tier ? USERS[tier] : undefined;
}

/** A small, stateful fake of the real API (same contracts); tests override with `server.use`. */
export const handlers = [
  http.get(url('/v1/categories'), () => contract(CategoryListResponseSchema, { data: CATEGORIES })),

  http.get(url('/v1/items'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') ?? 20);
    const offset = Number(params.get('cursor') ?? 0);
    const category = params.get('category');
    const filtered = category ? CATALOG.filter((i) => i.category.slug === category) : CATALOG;
    const data = filtered.slice(offset, offset + limit);
    const next = offset + limit;
    return contract(ItemListResponseSchema, {
      data,
      nextCursor: next < filtered.length ? String(next) : null,
    });
  }),

  http.get(url('/v1/items/:id'), ({ params }) => {
    const item = CATALOG.find((i) => i.id === params.id);
    return item ? contract(ItemSchema, item) : apiError(404, 'NOT_FOUND');
  }),

  http.get(url('/v1/items/:id/playback'), ({ params, request }) => {
    const user = currentUser(request);
    if (!user) return apiError(401, 'UNAUTHORIZED');
    const item = CATALOG.find((i) => i.id === params.id);
    if (!item) return apiError(404, 'NOT_FOUND');
    if (item.requiredTier === 'premium' && user.tier !== 'premium')
      return apiError(403, 'FORBIDDEN');
    return contract(PlaybackResponseSchema, {
      itemId: item.id,
      streamUrl: `https://cdn.test/${item.id}.m3u8`,
    });
  }),

  http.post(url('/v1/auth/login'), async ({ request }) => {
    const { username, password } = (await request.json()) as Record<string, string>;
    const tier = (Object.keys(USERS) as (keyof typeof USERS)[]).find(
      (t) => USERS[t].username === username,
    );
    if (!tier || password !== TEST_PASSWORD) {
      return apiError(401, 'UNAUTHORIZED', 'Invalid username or password');
    }
    const token = `token-${tier}`;
    validTokens.set(token, tier);
    return contract(LoginResponseSchema, {
      token,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      user: USERS[tier],
    });
  }),

  http.post(url('/v1/auth/logout'), ({ request }) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
    if (!token || !validTokens.has(token)) return apiError(401, 'UNAUTHORIZED');
    validTokens.delete(token);
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(url('/v1/me'), ({ request }) => {
    const user = currentUser(request);
    return user ? contract(MeResponseSchema, { user }) : apiError(401, 'UNAUTHORIZED');
  }),

  http.get(url('/v1/me/progress'), ({ request }) => {
    const user = currentUser(request);
    if (!user) return apiError(401, 'UNAUTHORIZED');
    const itemIds = new URL(request.url).searchParams.get('itemIds')?.split(',');
    const all = [...(fakeProgress.get(user.id)?.values() ?? [])];
    const data = itemIds ? all.filter((p) => itemIds.includes(p.itemId)) : all;
    return contract(ProgressListResponseSchema, { data });
  }),

  http.post(url('/v1/me/progress/batch'), async ({ request }) => {
    const user = currentUser(request);
    if (!user) return apiError(401, 'UNAUTHORIZED');
    const parsed = ProgressBatchRequestSchema.safeParse(await request.json());
    if (!parsed.success) return apiError(400, 'VALIDATION_ERROR');
    receivedBatches.push(parsed.data.events);
    const states = fakeProgress.get(user.id) ?? new Map<string, Progress>();
    fakeProgress.set(user.id, states);
    const results = parsed.data.events.map((event): ProgressBatchResult => {
      const item = CATALOG.find((i) => i.id === event.itemId);
      if (!item) return { eventId: event.eventId, status: 'rejected', reason: 'unknown_item' };
      const current = states.get(event.itemId);
      if (current && !isNewerObservation(event, current)) {
        return { eventId: event.eventId, status: 'stale', progress: current };
      }
      const progress = makeProgress(event.itemId, event.positionSec, {
        recordedAt: event.recordedAt,
        deviceId: event.deviceId,
      });
      states.set(event.itemId, progress);
      return { eventId: event.eventId, status: 'applied', progress };
    });
    return contract(ProgressBatchResponseSchema, { results });
  }),
];

/** Canonical progress as the API would return it for a catalog item. */
export function makeProgress(
  itemId: string,
  positionSec: number,
  overrides: Partial<Progress> = {},
): Progress {
  const durationSec = CATALOG.find((i) => i.id === itemId)?.durationSec ?? 635;
  return {
    itemId,
    positionSec,
    durationSec,
    completed: isCompleted(positionSec, durationSec),
    recordedAt: new Date().toISOString(),
    deviceId: 'other-device',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Seeds progress the "server" already has (e.g. from another device). */
export function seedServerProgress(userId: string, progress: Progress) {
  const states = fakeProgress.get(userId) ?? new Map<string, Progress>();
  states.set(progress.itemId, progress);
  fakeProgress.set(userId, states);
}

export const server = setupServer(...handlers);
