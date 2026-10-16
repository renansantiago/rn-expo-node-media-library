import { http, HttpResponse } from 'msw';
import { createApiClient } from '../../lib/api';
import { createLogger } from '../../lib/logger';
import { CATALOG, itemId, USERS } from '../../test/fixtures';
import {
  apiError,
  fakeProgress,
  makeProgress,
  receivedBatches,
  seedServerProgress,
  server,
  TEST_API_URL,
} from '../../test/server';
import { createMigratedTestDatabase } from '../../test/sqlite';
import { createProgressStore } from './store';
import { createProgressSync, outboxRetryDelay } from './sync';

const USER = USERS.free;
const ITEM = CATALOG.find((i) => i.requiredTier === 'free')!;
const OTHER = CATALOG.filter((i) => i.requiredTier === 'free')[1]!;
const BATCH_URL = `${TEST_API_URL}/v1/me/progress/batch`;
const silent = createLogger({ minLevel: 'silent' });

async function setup({ token = 'token-free' }: { token?: string } = {}) {
  const store = createProgressStore(await createMigratedTestDatabase());
  const client = createApiClient({
    baseUrl: TEST_API_URL,
    timeoutMs: 500,
    logger: silent,
    getAuthToken: () => token,
  });
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let nextHandle = 1;
  const sync = createProgressSync({
    store,
    client,
    userId: USER.id,
    logger: silent,
    random: () => 1,
    setTimer: (fn, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { fn, ms });
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => timers.delete(handle as unknown as number),
  });
  const save = (item: { id: string; durationSec: number }, positionSec: number) =>
    store.record(USER.id, { itemId: item.id, positionSec, durationSec: item.durationSec });
  return { store, sync, timers, save };
}

describe('progress sync', () => {
  it('delivers the outbox, empties it and merges the canonical state', async () => {
    const { store, sync, save } = await setup();
    await save(ITEM, 120);
    await save(OTHER, 30);

    await expect(sync.flush()).resolves.toBe('synced');
    expect(receivedBatches).toHaveLength(1);
    expect(receivedBatches[0]).toHaveLength(2);
    expect(await store.pendingCount(USER.id)).toBe(0);
    expect(fakeProgress.get(USER.id)?.get(ITEM.id)?.positionSec).toBe(120);

    await expect(sync.flush()).resolves.toBe('idle');
    expect(receivedBatches).toHaveLength(1);
  });

  it('adopts the server state when another device has a newer observation', async () => {
    const { store, sync, save } = await setup();
    await save(ITEM, 500); // watched offline earlier…
    seedServerProgress(
      USER.id,
      makeProgress(ITEM.id, 90, {
        recordedAt: new Date(Date.now() + 60_000).toISOString(),
        deviceId: 'tablet-0001',
      }),
    ); // …but the tablet watched later

    await sync.flush();
    expect(await store.get(USER.id, ITEM.id)).toMatchObject({
      positionSec: 90,
      deviceId: 'tablet-0001',
    });
    expect(await store.pendingCount(USER.id)).toBe(0);
  });

  it('drops events the server rejects as permanently invalid, without blocking the rest', async () => {
    const { store, sync, save } = await setup();
    await save({ id: itemId(999), durationSec: 60 }, 10); // not in the catalog → rejected
    await save(ITEM, 20);

    await expect(sync.flush()).resolves.toBe('synced');
    expect(await store.pendingCount(USER.id)).toBe(0);
    expect(fakeProgress.get(USER.id)?.has(ITEM.id)).toBe(true);
  });

  it.each([
    ['offline', () => HttpResponse.error()],
    ['a server error', () => apiError(503, 'SERVICE_UNAVAILABLE')],
    ['rate limiting', () => apiError(429, 'RATE_LIMITED')],
  ])('keeps events and retries with backoff when %s', async (_label, failure) => {
    const { store, sync, timers, save } = await setup();
    const entry = await save(ITEM, 120);
    server.use(http.post(BATCH_URL, failure));

    await expect(sync.flush()).resolves.toBe('retry_scheduled');
    expect(await store.due(USER.id)).toEqual([]); // backing off
    expect(await store.pendingCount(USER.id)).toBe(1);
    const [timer] = [...timers.values()];
    expect(timer?.ms).toBeGreaterThan(0);
    expect(timer?.ms).toBeLessThanOrEqual(outboxRetryDelay(1, () => 1));

    // Connectivity is back; the armed timer fires and the retry succeeds.
    server.resetHandlers();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    timer!.fn();
    await expect(sync.flush()).resolves.toBe('synced');
    jest.restoreAllMocks();
    expect(await store.pendingCount(USER.id)).toBe(0);
    expect(fakeProgress.get(USER.id)?.get(ITEM.id)?.positionSec).toBe(entry.positionSec);
  });

  it('can skip the backoff when the cause of the failures is gone (back online)', async () => {
    const { store, sync, save } = await setup();
    await save(ITEM, 120);
    server.use(http.post(BATCH_URL, () => HttpResponse.error()));
    await sync.flush();
    server.resetHandlers();

    await expect(sync.flush()).resolves.toBe('idle'); // still backing off
    await expect(sync.flush({ ignoreBackoff: true })).resolves.toBe('synced');
    expect(await store.pendingCount(USER.id)).toBe(0);
  });

  it('keeps events (no retry timer) when the session is rejected', async () => {
    const { store, sync, timers, save } = await setup({ token: 'revoked-token' });
    await save(ITEM, 120);
    await expect(sync.flush()).resolves.toBe('unauthorized');
    expect(await store.pendingCount(USER.id)).toBe(1);
    expect(timers.size).toBe(0);
  });

  it('backs off on unexpected client errors instead of dropping data', async () => {
    const { store, sync, save } = await setup();
    await save(ITEM, 120);
    server.use(http.post(BATCH_URL, () => apiError(400, 'VALIDATION_ERROR')));
    await expect(sync.flush()).resolves.toBe('retry_scheduled');
    expect(await store.pendingCount(USER.id)).toBe(1);
  });

  it('runs one flush at a time and picks up saves made while a request is in flight', async () => {
    const { store, sync, save } = await setup();
    await save(ITEM, 10);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.post(BATCH_URL, async () => {
        await gate;
        return undefined; // fall through to the default handler
      }),
    );

    const first = sync.flush();
    const second = sync.flush();
    expect(second).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await save(ITEM, 20); // replaces the in-flight event in the outbox
    const third = sync.flush();
    release();
    server.resetHandlers();

    await Promise.all([first, third]);
    expect(receivedBatches.map((batch) => batch.length)).toEqual([1, 1]);
    expect(await store.pendingCount(USER.id)).toBe(0);
    expect(fakeProgress.get(USER.id)?.get(ITEM.id)?.positionSec).toBe(20);
  });

  it('splits large outboxes into batches of at most 100 events', async () => {
    const { store, sync, save } = await setup();
    for (let i = 0; i < 150; i++) await save({ id: itemId(1000 + i), durationSec: 60 }, 10);
    await sync.flush();
    expect(receivedBatches.map((batch) => batch.length)).toEqual([100, 50]);
    expect(await store.pendingCount(USER.id)).toBe(0);
  });

  it('pulls other devices’ progress into the local store', async () => {
    const { store, sync } = await setup();
    seedServerProgress(USER.id, makeProgress(ITEM.id, 300));
    seedServerProgress(USER.id, makeProgress(OTHER.id, 60));

    await sync.pull([ITEM.id]);
    expect((await store.list(USER.id)).map((p) => p.itemId)).toEqual([ITEM.id]);
    await sync.pull();
    expect(await store.list(USER.id)).toHaveLength(2);
  });

  it('stops scheduling after dispose', async () => {
    const { sync, timers, save } = await setup();
    await save(ITEM, 10);
    server.use(http.post(BATCH_URL, () => HttpResponse.error()));
    await sync.flush();
    expect(timers.size).toBe(1);
    sync.dispose();
    expect(timers.size).toBe(0);
    await expect(sync.flush()).resolves.toBe('idle');
  });
});

describe('outboxRetryDelay', () => {
  it('grows exponentially with jitter and is capped at 5 minutes', () => {
    expect(outboxRetryDelay(1, () => 0)).toBe(1_000);
    expect(outboxRetryDelay(1, () => 1)).toBe(2_000);
    expect(outboxRetryDelay(4, () => 1)).toBe(16_000);
    expect(outboxRetryDelay(50, () => 1)).toBe(300_000);
  });
});
