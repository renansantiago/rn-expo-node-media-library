import { isCompleted, type Progress, type ProgressWriteStatus } from '@media-library/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { items, playbackProgress, progressEvents, type PlaybackProgressRow } from '../../db/schema';

export interface RecordEventInput {
  userId: string;
  itemId: string;
  eventId: string;
  positionSec: number;
  recordedAt: Date;
  deviceId: string;
  receivedAt: Date;
}

function toProgress(row: PlaybackProgressRow, durationSec: number): Progress {
  return {
    itemId: row.itemId,
    positionSec: row.positionSec,
    durationSec,
    completed: isCompleted(row.positionSec, durationSec),
    recordedAt: row.clientRecordedAt.toISOString(),
    deviceId: row.deviceId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The incoming row wins only if it is a newer observation: later client `recorded_at`, or the same
 * instant from a greater `device_id`, or (same device and instant) a greater event id. Evaluated by SQLite inside the upsert, so it is atomic even
 * with several API processes writing the same row (SQLite serialises writers).
 * Mirrors `isNewerObservation` from the shared contracts.
 */
const incomingIsNewer = sql`excluded.client_recorded_at > ${playbackProgress.clientRecordedAt}
  OR (excluded.client_recorded_at = ${playbackProgress.clientRecordedAt}
      AND excluded.device_id > ${playbackProgress.deviceId})
  OR (excluded.client_recorded_at = ${playbackProgress.clientRecordedAt}
      AND excluded.device_id = ${playbackProgress.deviceId}
      AND excluded.last_event_id > ${playbackProgress.lastEventId})`;

export function createProgressRepository(db: Db) {
  const selectProgress = () =>
    db
      .select({ progress: playbackProgress, durationSec: items.durationSec })
      .from(playbackProgress)
      .innerJoin(items, eq(playbackProgress.itemId, items.id));

  return {
    /**
     * Idempotent last-write-wins upsert, in one transaction:
     * 1. an already-seen (user, eventId) is a no-op that returns the current state;
     * 2. otherwise the event is upserted under the multi-device rule and logged with its outcome.
     */
    recordEvent(input: RecordEventInput): { status: ProgressWriteStatus; progress: Progress } {
      return db.transaction((tx) => {
        const seen = tx
          .select({ eventId: progressEvents.eventId })
          .from(progressEvents)
          .where(
            and(eq(progressEvents.userId, input.userId), eq(progressEvents.eventId, input.eventId)),
          )
          .get();

        let status: ProgressWriteStatus = 'duplicate';
        if (!seen) {
          const { changes } = tx
            .insert(playbackProgress)
            .values({
              userId: input.userId,
              itemId: input.itemId,
              positionSec: input.positionSec,
              clientRecordedAt: input.recordedAt,
              deviceId: input.deviceId,
              lastEventId: input.eventId,
              updatedAt: input.receivedAt,
            })
            .onConflictDoUpdate({
              target: [playbackProgress.userId, playbackProgress.itemId],
              set: {
                positionSec: sql`excluded.position_sec`,
                clientRecordedAt: sql`excluded.client_recorded_at`,
                deviceId: sql`excluded.device_id`,
                lastEventId: sql`excluded.last_event_id`,
                updatedAt: sql`excluded.updated_at`,
              },
              setWhere: incomingIsNewer,
            })
            .run();
          status = changes > 0 ? 'applied' : 'stale';

          tx.insert(progressEvents)
            .values({
              userId: input.userId,
              eventId: input.eventId,
              itemId: input.itemId,
              positionSec: input.positionSec,
              clientRecordedAt: input.recordedAt,
              deviceId: input.deviceId,
              receivedAt: input.receivedAt,
              outcome: status,
            })
            .run();
        }

        const current = selectProgress()
          .where(
            and(
              eq(playbackProgress.userId, input.userId),
              eq(playbackProgress.itemId, input.itemId),
            ),
          )
          .get();
        // A duplicate event always has a row: its first delivery created or lost to one.
        if (!current) throw new Error('progress row missing after upsert');
        return { status, progress: toProgress(current.progress, current.durationSec) };
      });
    },

    /** The given items' progress, or the most recently watched items when `itemIds` is omitted. */
    listProgress(userId: string, { itemIds, limit }: { itemIds?: string[]; limit: number }) {
      const conditions = [eq(playbackProgress.userId, userId)];
      if (itemIds) conditions.push(inArray(playbackProgress.itemId, itemIds));
      return selectProgress()
        .where(and(...conditions))
        .orderBy(desc(playbackProgress.clientRecordedAt))
        .limit(itemIds ? itemIds.length : limit)
        .all()
        .map((row) => toProgress(row.progress, row.durationSec));
    },
  };
}

export type ProgressRepository = ReturnType<typeof createProgressRepository>;
