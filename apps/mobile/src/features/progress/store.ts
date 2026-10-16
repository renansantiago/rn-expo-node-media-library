import { PROGRESS_BATCH_MAX, type Progress } from '@media-library/contracts';
import type { SqlDatabase } from '../../lib/db/database';
import { newId as defaultNewId } from '../../lib/ids';

export interface LocalProgress {
  itemId: string;
  positionSec: number;
  durationSec: number;
  /** Device clock (ms) when the position was observed; the multi-device rule compares this. */
  recordedAt: number;
  deviceId: string;
}

export interface OutboxEntry {
  itemId: string;
  eventId: string;
  positionSec: number;
  recordedAt: number;
  deviceId: string;
  attempts: number;
  nextAttemptAt: number;
}

interface ProgressRow {
  item_id: string;
  position_sec: number;
  duration_sec: number;
  recorded_at: number;
  device_id: string;
}

interface OutboxRow extends Omit<ProgressRow, 'duration_sec'> {
  event_id: string;
  attempts: number;
  next_attempt_at: number;
}

const toProgress = (row: ProgressRow): LocalProgress => ({
  itemId: row.item_id,
  positionSec: row.position_sec,
  durationSec: row.duration_sec,
  recordedAt: row.recorded_at,
  deviceId: row.device_id,
});

const toOutboxEntry = (row: OutboxRow): OutboxEntry => ({
  itemId: row.item_id,
  eventId: row.event_id,
  positionSec: row.position_sec,
  recordedAt: row.recorded_at,
  deviceId: row.device_id,
  attempts: row.attempts,
  nextAttemptAt: row.next_attempt_at,
});

/** Same rule as the API (`isNewerObservation`): later device time wins, ties go to the greater device id. */
const INCOMING_IS_NEWER = (table: string) =>
  `excluded.recorded_at > ${table}.recorded_at
   OR (excluded.recorded_at = ${table}.recorded_at AND excluded.device_id > ${table}.device_id)`;

const UPSERT_PROGRESS = `
  INSERT INTO progress (user_id, item_id, position_sec, duration_sec, recorded_at, device_id)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, item_id) DO UPDATE SET
    position_sec = excluded.position_sec,
    duration_sec = excluded.duration_sec,
    recorded_at = excluded.recorded_at,
    device_id = excluded.device_id
  WHERE ${INCOMING_IS_NEWER('progress')}`;

/** Coalescing: one pending event per (user, item); a newer save replaces the queued one. */
const UPSERT_OUTBOX = `
  INSERT INTO outbox (user_id, item_id, event_id, position_sec, recorded_at, device_id)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (user_id, item_id) DO UPDATE SET
    event_id = excluded.event_id,
    position_sec = excluded.position_sec,
    recorded_at = excluded.recorded_at,
    device_id = excluded.device_id,
    attempts = 0,
    next_attempt_at = 0,
    last_error = NULL
  WHERE excluded.recorded_at > outbox.recorded_at`;

/** Runs async tasks one at a time so multi-statement operations never interleave on the connection. */
function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.catch(() => undefined);
    return result;
  };
}

interface StoreOptions {
  newId?: () => string;
  now?: () => number;
}

/**
 * On-device source of truth for playback progress. Every save lands here first (so it survives
 * crashes, backgrounding and offline periods) and is queued in the outbox for the sync engine.
 */
export function createProgressStore(
  db: SqlDatabase,
  { newId = defaultNewId, now = () => Date.now() }: StoreOptions = {},
) {
  const serial = createSerialQueue();
  const listeners = new Set<(userId: string) => void>();
  const notify = (userId: string) => listeners.forEach((listener) => listener(userId));
  let deviceId: string | undefined;
  let lastRecordedAt = 0;

  async function loadDeviceId(): Promise<string> {
    if (deviceId) return deviceId;
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'device_id'",
      [],
    );
    if (row) return (deviceId = row.value);
    const created = newId();
    await db.runAsync("INSERT OR IGNORE INTO meta (key, value) VALUES ('device_id', ?)", [created]);
    return loadDeviceId();
  }

  return {
    /** Random per-install id, created on first use and kept for the life of the install. */
    getDeviceId: () => serial(loadDeviceId),

    /**
     * Records a position observed on this device: updates local progress and queues an event.
     * Timestamps are strictly increasing so two saves in the same millisecond still order correctly.
     */
    record(
      userId: string,
      input: { itemId: string; positionSec: number; durationSec: number },
    ): Promise<OutboxEntry> {
      return serial(async () => {
        const device = await loadDeviceId();
        // Our own previous observation must never win over a newer one, even if the clock moved
        // backwards (NTP correction, manual change) since it was recorded.
        const own = await db.getFirstAsync<{ recorded_at: number }>(
          'SELECT recorded_at FROM progress WHERE user_id = ? AND item_id = ? AND device_id = ?',
          [userId, input.itemId, device],
        );
        const recordedAt = Math.max(now(), lastRecordedAt + 1, (own?.recorded_at ?? 0) + 1);
        lastRecordedAt = recordedAt;
        const positionSec = Math.max(0, Math.min(input.positionSec, input.durationSec || Infinity));
        const entry: OutboxEntry = {
          itemId: input.itemId,
          eventId: newId(),
          positionSec,
          recordedAt,
          deviceId: device,
          attempts: 0,
          nextAttemptAt: 0,
        };
        await db.withTransactionAsync(async () => {
          await db.runAsync(UPSERT_PROGRESS, [
            userId,
            input.itemId,
            positionSec,
            input.durationSec,
            recordedAt,
            device,
          ]);
          await db.runAsync(UPSERT_OUTBOX, [
            userId,
            input.itemId,
            entry.eventId,
            positionSec,
            recordedAt,
            device,
          ]);
        });
        notify(userId);
        return entry;
      });
    },

    get(userId: string, itemId: string): Promise<LocalProgress | null> {
      return serial(async () => {
        const row = await db.getFirstAsync<ProgressRow>(
          'SELECT * FROM progress WHERE user_id = ? AND item_id = ?',
          [userId, itemId],
        );
        return row ? toProgress(row) : null;
      });
    },

    list(userId: string): Promise<LocalProgress[]> {
      return serial(async () =>
        (
          await db.getAllAsync<ProgressRow>(
            'SELECT * FROM progress WHERE user_id = ? ORDER BY recorded_at DESC',
            [userId],
          )
        ).map(toProgress),
      );
    },

    /**
     * Merges canonical server state (from a sync response or a pull) under the multi-device rule:
     * a newer observation from another device replaces ours; ours wins if it is newer and unsynced.
     */
    applyServerState(userId: string, states: Progress[]): Promise<number> {
      if (!states.length) return Promise.resolve(0);
      return serial(async () => {
        let changed = 0;
        await db.withTransactionAsync(async () => {
          for (const state of states) {
            const { changes } = await db.runAsync(UPSERT_PROGRESS, [
              userId,
              state.itemId,
              state.positionSec,
              state.durationSec,
              Date.parse(state.recordedAt),
              state.deviceId,
            ]);
            changed += changes;
          }
        });
        if (changed) notify(userId);
        return changed;
      });
    },

    /**
     * Events due for delivery, oldest observation first. `ignoreBackoff` returns every pending
     * event (used when connectivity returns: the reason for backing off is gone).
     */
    due(
      userId: string,
      { limit = PROGRESS_BATCH_MAX, ignoreBackoff = false } = {},
    ): Promise<OutboxEntry[]> {
      return serial(async () =>
        (
          await db.getAllAsync<OutboxRow>(
            `SELECT * FROM outbox WHERE user_id = ? AND next_attempt_at <= ?
             ORDER BY recorded_at LIMIT ?`,
            [userId, ignoreBackoff ? Number.MAX_SAFE_INTEGER : now(), limit],
          )
        ).map(toOutboxEntry),
      );
    },

    /** Earliest scheduled retry for the user's pending events, or null when the outbox is empty. */
    nextAttemptAt(userId: string): Promise<number | null> {
      return serial(async () => {
        const row = await db.getFirstAsync<{ next: number | null }>(
          'SELECT MIN(next_attempt_at) AS next FROM outbox WHERE user_id = ?',
          [userId],
        );
        return row?.next ?? null;
      });
    },

    pendingCount(userId: string): Promise<number> {
      return serial(async () => {
        const row = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM outbox WHERE user_id = ?',
          [userId],
        );
        return row?.count ?? 0;
      });
    },

    /**
     * Removes delivered events. Matching on event id means an event replaced by a newer save while
     * the request was in flight stays queued.
     */
    acknowledge(userId: string, eventIds: string[]): Promise<void> {
      if (!eventIds.length) return Promise.resolve();
      return serial(async () => {
        await db.withTransactionAsync(async () => {
          for (const eventId of eventIds) {
            await db.runAsync('DELETE FROM outbox WHERE user_id = ? AND event_id = ?', [
              userId,
              eventId,
            ]);
          }
        });
      });
    },

    /** Schedules a retry for events whose delivery failed. Events are never dropped here. */
    reschedule(
      userId: string,
      eventIds: string[],
      { error, delayMs }: { error: string; delayMs: (attempts: number) => number },
    ): Promise<void> {
      if (!eventIds.length) return Promise.resolve();
      return serial(async () => {
        await db.withTransactionAsync(async () => {
          for (const eventId of eventIds) {
            const row = await db.getFirstAsync<{ attempts: number }>(
              'SELECT attempts FROM outbox WHERE user_id = ? AND event_id = ?',
              [userId, eventId],
            );
            if (!row) continue;
            const attempts = row.attempts + 1;
            await db.runAsync(
              `UPDATE outbox SET attempts = ?, next_attempt_at = ?, last_error = ?
               WHERE user_id = ? AND event_id = ?`,
              [attempts, now() + delayMs(attempts), error, userId, eventId],
            );
          }
        });
      });
    },

    subscribe(listener: (userId: string) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ProgressStore = ReturnType<typeof createProgressStore>;
