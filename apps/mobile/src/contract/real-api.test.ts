import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CategoryListResponseSchema,
  ItemListResponseSchema,
  LoginResponseSchema,
  PlaybackResponseSchema,
  type Item,
} from '@media-library/contracts';
import { createProgressStore } from '../features/progress/store';
import { createProgressSync } from '../features/progress/sync';
import { createApiClient, HttpError, type ApiClient } from '../lib/api';
import { createLogger } from '../lib/logger';
import { server as fakeApi } from '../test/server';
import { createMigratedTestDatabase } from '../test/sqlite';

/**
 * Cross-check: the app's real networking and sync code against the real API (a child process with
 * a scratch database), instead of the MSW fake. Unit tests on each side prove each side honours
 * the shared contract; this proves they actually work together.
 */

const API_DIR = resolve(__dirname, '../../../api');
const PASSWORD = 'contract-password';
const silent = createLogger({ minLevel: 'silent' });

/**
 * jest-expo replaces `fetch` with a stub, so requests go through Node's http module instead; the
 * API client takes any fetch-compatible function.
 */
const nodeFetch = ((input: string, init: RequestInit = {}) =>
  new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      input,
      {
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        signal: init.signal ?? undefined,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolvePromise({
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode,
            headers: { get: (name: string) => (res.headers[name.toLowerCase()] as string) ?? null },
            text: async () => body,
          }),
        );
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body as string);
    req.end();
  })) as unknown as typeof fetch;

const freePort = () =>
  new Promise<number>((resolvePromise) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePromise(port));
    });
  });

describe('app ↔ real API', () => {
  let api: ChildProcess;
  let baseUrl: string;
  let dataDir: string;
  const correlationIds: string[] = [];

  const client = (token?: string): ApiClient =>
    createApiClient({
      baseUrl,
      timeoutMs: 5_000,
      logger: silent,
      fetchFn: nodeFetch,
      getAuthToken: () => token,
      newCorrelationId: () => {
        const id = `contract-${correlationIds.length.toString().padStart(4, '0')}`;
        correlationIds.push(id);
        return id;
      },
    });

  const login = async (username: string) =>
    client().request({
      method: 'POST',
      path: '/v1/auth/login',
      body: { username, password: PASSWORD },
      schema: LoginResponseSchema,
    });

  beforeAll(async () => {
    fakeApi.close(); // real network for this file
    dataDir = mkdtempSync(join(tmpdir(), 'media-library-contract-'));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      DATABASE_PATH: join(dataDir, 'contract.db'),
      DEMO_USER_PASSWORD: PASSWORD,
      RATE_LIMIT_LOGIN_MAX: '5',
    };
    const reset = spawnSync('npx', ['tsx', 'src/db/cli.ts', 'reset'], { cwd: API_DIR, env });
    if (reset.status !== 0) throw new Error(`db reset failed: ${reset.stderr}`);
    api = spawn('npx', ['tsx', 'src/server.ts'], { cwd: API_DIR, env, stdio: 'ignore' });

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await nodeFetch(`${baseUrl}/health`);
        if (res.ok) break;
      } catch {
        // not listening yet
      }
      if (attempt > 100) throw new Error('API did not start');
      await new Promise((r) => setTimeout(r, 100));
    }
  }, 60_000);

  afterAll(async () => {
    api?.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
    fakeApi.listen({ onUnhandledRequest: 'error' });
  });

  it('parses real catalog responses and walks every page with the cursor', async () => {
    const categories = await client().request({
      path: '/v1/categories',
      schema: CategoryListResponseSchema,
    });
    expect(categories.data.length).toBeGreaterThan(0);

    const seen: Item[] = [];
    let cursor: string | undefined;
    do {
      const page = await client().request({
        path: '/v1/items',
        query: { limit: 7, cursor },
        schema: ItemListResponseSchema,
      });
      seen.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen.map((i) => i.id)).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(20);
  });

  it('maps real errors to typed errors carrying the app-generated correlation id', async () => {
    const { token } = await login('free-user');
    const items = await client().request({
      path: '/v1/items',
      query: { limit: 50 },
      schema: ItemListResponseSchema,
    });
    const premium = items.data.find((i) => i.requiredTier === 'premium')!;
    const free = items.data.find((i) => i.requiredTier === 'free')!;

    const grant = await client(token).request({
      path: `/v1/items/${free.id}/playback`,
      schema: PlaybackResponseSchema,
    });
    expect(grant.itemId).toBe(free.id);

    const denied = await client(token)
      .request({ path: `/v1/items/${premium.id}/playback`, schema: PlaybackResponseSchema })
      .catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(HttpError);
    expect(denied).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    // The API reused the id the app minted, end to end.
    expect((denied as HttpError).correlationId).toBe(correlationIds.at(-1));
  });

  it('syncs progress from two devices and both converge on the newest observation', async () => {
    const { token, user } = await login('premium-user');
    const items = await client().request({
      path: '/v1/items',
      query: { limit: 50 },
      schema: ItemListResponseSchema,
    });
    const item = items.data.find((i) => i.durationSec >= 300)!;

    const device = async (offsetMs: number) => {
      let now = Date.now() + offsetMs;
      const store = createProgressStore(await createMigratedTestDatabase(), { now: () => now });
      const sync = createProgressSync({
        store,
        client: client(token),
        userId: user.id,
        logger: silent,
      });
      return { store, sync, advance: (ms: number) => (now += ms) };
    };
    const phone = await device(-10 * 60_000); // watched 10 min ago, offline
    const tablet = await device(-60_000); // watched 1 min ago

    await phone.store.record(user.id, {
      itemId: item.id,
      positionSec: 240,
      durationSec: item.durationSec,
    });
    await tablet.store.record(user.id, {
      itemId: item.id,
      positionSec: 90,
      durationSec: item.durationSec,
    });

    await expect(tablet.sync.flush()).resolves.toBe('synced');
    await expect(phone.sync.flush()).resolves.toBe('synced'); // stale on the server…
    // …and the phone adopted the tablet's newer state from the response.
    expect(await phone.store.get(user.id, item.id)).toMatchObject({ positionSec: 90 });

    await tablet.sync.pull([item.id]);
    expect(await tablet.store.get(user.id, item.id)).toMatchObject({ positionSec: 90 });
    expect(await phone.store.pendingCount(user.id)).toBe(0);
    phone.sync.dispose();
    tablet.sync.dispose();
  });

  it('surfaces rate limiting with the Retry-After the server sent', async () => {
    const attempt = async (): Promise<HttpError> => {
      try {
        await login('no-such-user');
      } catch (error) {
        return error as HttpError;
      }
      throw new Error('expected the login to fail');
    };
    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(limited.retryAfterMs).toBeGreaterThan(0);
  });
});
