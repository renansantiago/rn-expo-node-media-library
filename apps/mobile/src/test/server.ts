import type { ApiErrorBody } from '@media-library/contracts';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { CATALOG, CATEGORIES, TEST_PASSWORD, USERS } from './fixtures';

export const TEST_API_URL = 'http://api.test';
const url = (path: string) => `${TEST_API_URL}${path}`;

export const apiError = (
  status: number,
  code: ApiErrorBody['error']['code'],
  message: string = code,
) =>
  HttpResponse.json<ApiErrorBody>(
    { error: { code, message, correlationId: 'server-corr-0001' } },
    { status },
  );

/** Tokens the fake API accepts (revocable through /logout). */
const validTokens = new Map<string, keyof typeof USERS>();
export function resetFakeApi() {
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
  http.get(url('/v1/categories'), () => HttpResponse.json({ data: CATEGORIES })),

  http.get(url('/v1/items'), ({ request }) => {
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') ?? 20);
    const offset = Number(params.get('cursor') ?? 0);
    const category = params.get('category');
    const filtered = category ? CATALOG.filter((i) => i.category.slug === category) : CATALOG;
    const data = filtered.slice(offset, offset + limit);
    const next = offset + limit;
    return HttpResponse.json({ data, nextCursor: next < filtered.length ? String(next) : null });
  }),

  http.get(url('/v1/items/:id'), ({ params }) => {
    const item = CATALOG.find((i) => i.id === params.id);
    return item ? HttpResponse.json(item) : apiError(404, 'NOT_FOUND');
  }),

  http.get(url('/v1/items/:id/playback'), ({ params, request }) => {
    const user = currentUser(request);
    if (!user) return apiError(401, 'UNAUTHORIZED');
    const item = CATALOG.find((i) => i.id === params.id);
    if (!item) return apiError(404, 'NOT_FOUND');
    if (item.requiredTier === 'premium' && user.tier !== 'premium')
      return apiError(403, 'FORBIDDEN');
    return HttpResponse.json({ itemId: item.id, streamUrl: `https://cdn.test/${item.id}.m3u8` });
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
    return HttpResponse.json({
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
    return user ? HttpResponse.json({ user }) : apiError(401, 'UNAUTHORIZED');
  }),
];

export const server = setupServer(...handlers);
