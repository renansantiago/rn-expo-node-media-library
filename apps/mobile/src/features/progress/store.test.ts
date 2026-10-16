import { randomUUID } from 'node:crypto';
import { itemId } from '../../test/fixtures';
import { makeProgress } from '../../test/server';
import { createMigratedTestDatabase } from '../../test/sqlite';
import { createProgressStore } from './store';

const USER = 'user-1';
const ITEM = itemId(1);
const OTHER_ITEM = itemId(2);
const DEVICE = 'device-local-0001';

async function setup(start = 1_000_000) {
  const db = await createMigratedTestDatabase();
  const clock = { now: start };
  let ids = 0;
  const store = createProgressStore(db, {
    now: () => clock.now,
    newId: () => (ids++ === 0 ? DEVICE : randomUUID()),
  });
  return { db, clock, store };
}

const save = (
  store: Awaited<ReturnType<typeof setup>>['store'],
  positionSec: number,
  item = ITEM,
) => store.record(USER, { itemId: item, positionSec, durationSec: 600 });

describe('progress store', () => {
  it('creates a device id once and keeps it across store instances', async () => {
    const { db, store } = await setup();
    const first = await store.getDeviceId();
    expect(first).toBe(DEVICE);
    expect(await store.getDeviceId()).toBe(first);

    const reopened = createProgressStore(db, { newId: () => 'should-not-be-used' });
    expect(await reopened.getDeviceId()).toBe(DEVICE);
  });

  it('records locally first and queues one event for delivery', async () => {
    const { store } = await setup();
    const entry = await save(store, 42.5);

    expect(await store.get(USER, ITEM)).toEqual({
      itemId: ITEM,
      positionSec: 42.5,
      durationSec: 600,
      recordedAt: 1_000_000,
      deviceId: DEVICE,
    });
    expect(await store.due(USER)).toEqual([entry]);
    expect(entry).toMatchObject({ positionSec: 42.5, attempts: 0, deviceId: DEVICE });
  });

  it('coalesces the outbox to the latest save per item', async () => {
    const { store, clock } = await setup();
    await save(store, 10);
    clock.now += 10_000;
    const latest = await save(store, 20);
    await save(store, 5, OTHER_ITEM);

    const due = await store.due(USER);
    expect(due).toHaveLength(2);
    expect(due.find((e) => e.itemId === ITEM)).toEqual(latest);
    expect(await store.pendingCount(USER)).toBe(2);
  });

  it('keeps timestamps strictly increasing, even within one millisecond or if the clock goes back', async () => {
    const { store, clock } = await setup();
    const a = await save(store, 10);
    const b = await save(store, 11);
    expect(b.recordedAt).toBeGreaterThan(a.recordedAt);

    clock.now -= 60_000; // NTP correction / manual clock change
    const c = await save(store, 12);
    expect(c.recordedAt).toBeGreaterThan(b.recordedAt);
    expect((await store.get(USER, ITEM))?.positionSec).toBe(12);
  });

  it('clamps positions to [0, duration]', async () => {
    const { store } = await setup();
    expect((await save(store, 9_999)).positionSec).toBe(600);
    expect((await save(store, -3)).positionSec).toBe(0);
  });

  describe('applyServerState (multi-device rule)', () => {
    it('takes a newer observation from another device', async () => {
      const { store } = await setup();
      await save(store, 100);
      const remote = makeProgress(ITEM, 250, {
        recordedAt: new Date(1_000_500).toISOString(),
        deviceId: 'tablet-0001',
      });
      expect(await store.applyServerState(USER, [remote])).toBe(1);
      expect(await store.get(USER, ITEM)).toMatchObject({
        positionSec: 250,
        deviceId: 'tablet-0001',
      });
    });

    it('keeps a newer local (possibly unsynced) observation', async () => {
      const { store } = await setup();
      await save(store, 100);
      const older = makeProgress(ITEM, 250, { recordedAt: new Date(999_000).toISOString() });
      expect(await store.applyServerState(USER, [older])).toBe(0);
      expect((await store.get(USER, ITEM))?.positionSec).toBe(100);
    });

    it('breaks exact ties by the greater device id, like the server', async () => {
      const { store } = await setup();
      await save(store, 100);
      const at = new Date(1_000_000).toISOString();
      await store.applyServerState(USER, [
        makeProgress(ITEM, 1, { recordedAt: at, deviceId: 'aaa-device' }),
      ]);
      expect((await store.get(USER, ITEM))?.positionSec).toBe(100);
      await store.applyServerState(USER, [
        makeProgress(ITEM, 2, { recordedAt: at, deviceId: 'zzz-device' }),
      ]);
      expect((await store.get(USER, ITEM))?.positionSec).toBe(2);
    });

    it('notifies subscribers only when something changed', async () => {
      const { store } = await setup();
      const listener = jest.fn();
      const unsubscribe = store.subscribe(listener);
      await store.applyServerState(USER, [
        makeProgress(ITEM, 10, { recordedAt: new Date(5).toISOString() }),
      ]);
      await store.applyServerState(USER, [
        makeProgress(ITEM, 10, { recordedAt: new Date(1).toISOString() }),
      ]);
      await store.applyServerState(USER, []);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(USER);
      unsubscribe();
      await save(store, 20);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  it('acknowledges only the delivered event, so a save made mid-flight stays queued', async () => {
    const { store, clock } = await setup();
    const inFlight = await save(store, 10);
    clock.now += 1_000;
    const newer = await save(store, 20); // replaces the queued event while the request is in flight
    await store.acknowledge(USER, [inFlight.eventId]);
    expect(await store.due(USER)).toEqual([newer]);

    await store.acknowledge(USER, [newer.eventId]);
    expect(await store.pendingCount(USER)).toBe(0);
  });

  it('reschedules failed events with backoff and never drops them', async () => {
    const { store, clock } = await setup();
    const entry = await save(store, 10);
    const delayMs = jest.fn((attempts: number) => attempts * 1_000);

    await store.reschedule(USER, [entry.eventId], { error: 'offline', delayMs });
    expect(delayMs).toHaveBeenCalledWith(1);
    expect(await store.due(USER)).toEqual([]);
    expect(await store.nextAttemptAt(USER)).toBe(clock.now + 1_000);

    clock.now += 1_000;
    expect(await store.due(USER)).toMatchObject([{ eventId: entry.eventId, attempts: 1 }]);
    await store.reschedule(USER, [entry.eventId, 'unknown-event'], { error: 'offline', delayMs });
    expect(delayMs).toHaveBeenLastCalledWith(2);
    expect(await store.pendingCount(USER)).toBe(1);
  });

  it('a new save resets the backoff so it is delivered promptly', async () => {
    const { store, clock } = await setup();
    const entry = await save(store, 10);
    await store.reschedule(USER, [entry.eventId], { error: 'offline', delayMs: () => 60_000 });
    clock.now += 1;
    await save(store, 20);
    expect(await store.due(USER)).toMatchObject([{ positionSec: 20, attempts: 0 }]);
  });

  it('isolates users sharing a device', async () => {
    const { store } = await setup();
    await save(store, 10);
    expect(await store.list('someone-else')).toEqual([]);
    expect(await store.due('someone-else')).toEqual([]);
    expect(await store.nextAttemptAt('someone-else')).toBeNull();
    expect(await store.list(USER)).toHaveLength(1);
  });
});
