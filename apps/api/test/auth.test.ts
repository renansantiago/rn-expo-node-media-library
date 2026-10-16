import { LoginResponseSchema, MeResponseSchema } from '@media-library/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authTokens } from '../src/db/schema';
import { extractBearerToken } from '../src/plugins/auth';
import {
  bearer,
  createTestApp,
  FREE_USER,
  PREMIUM_USER,
  TEST_PASSWORD,
  type TestContext,
} from './helpers';

describe('auth', () => {
  let ctx: TestContext;
  let clock: Date;
  beforeEach(async () => {
    clock = new Date(Date.UTC(2026, 5, 1));
    ctx = await createTestApp({ now: () => clock, tokenTtlHours: 1 });
  });
  afterEach(() => ctx.close());

  const login = (username: string, password: string) =>
    ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });

  describe('POST /v1/auth/login', () => {
    it('issues an opaque token with an expiry and the user profile', async () => {
      const res = await login(PREMIUM_USER, TEST_PASSWORD);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const body = LoginResponseSchema.parse(res.json());
      expect(body.user).toEqual({
        id: 'user-premium',
        username: PREMIUM_USER,
        displayName: 'Premium Demo',
        tier: 'premium',
      });
      expect(body.expiresAt).toBe(new Date(clock.getTime() + 60 * 60 * 1000).toISOString());
      expect(body.token.length).toBeGreaterThanOrEqual(43);
    });

    it('stores only a hash of the token', async () => {
      const { token } = LoginResponseSchema.parse((await login(FREE_USER, TEST_PASSWORD)).json());
      const rows = ctx.handle.db.select().from(authTokens).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tokenHash).not.toBe(token);
    });

    it.each([
      ['wrong password', FREE_USER, 'nope'],
      ['unknown user', 'ghost', TEST_PASSWORD],
    ])('rejects %s with the same generic 401', async (_label, username, password) => {
      const res = await login(username, password);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Invalid username or password',
      });
    });

    it.each([
      [{}],
      [{ username: '', password: 'x' }],
      [{ username: 'a', password: '' }],
      [{ username: 'a'.repeat(65), password: 'x' }],
      [{ username: 123, password: 'x' }],
    ])('validates the request body %j', async (payload) => {
      const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('purges expired tokens on login', async () => {
      await ctx.login();
      clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
      await ctx.login();
      expect(ctx.handle.db.select().from(authTokens).all()).toHaveLength(1);
    });
  });

  describe('GET /v1/me', () => {
    it('returns the current user for a valid token', async () => {
      const token = await ctx.login(FREE_USER);
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
      expect(res.statusCode).toBe(200);
      expect(MeResponseSchema.parse(res.json()).user.username).toBe(FREE_USER);
    });

    it.each([
      ['no header', {}],
      ['wrong scheme', { authorization: 'Basic abc' }],
      ['unknown token', bearer('x'.repeat(43))],
      ['malformed token', bearer('short')],
    ])('rejects requests with %s', async (_label, headers) => {
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('rejects expired tokens', async () => {
      const token = await ctx.login();
      clock = new Date(clock.getTime() + 60 * 60 * 1000);
      const res = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('revokes the token', async () => {
      const token = await ctx.login();
      const out = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: bearer(token),
      });
      expect(out.statusCode).toBe(204);
      const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(token) });
      expect(me.statusCode).toBe(401);
    });

    it('requires authentication', async () => {
      const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout' });
      expect(res.statusCode).toBe(401);
    });
  });
});

describe('extractBearerToken', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['Bearer', null],
    ['bearer abcdefghijklmnopqrstu', null],
    ['Bearer abcdefghijklmnop qrstu', null],
    ['Bearer abcdefghijklmnopqrstu', 'abcdefghijklmnopqrstu'],
  ])('%j → %j', (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });
});
