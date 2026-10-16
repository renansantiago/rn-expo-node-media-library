import {
  canWatch,
  PROGRESS_MAX_CLOCK_SKEW_MS,
  type Progress,
  type ProgressEventFields,
  type ProgressRejectReason,
  type ProgressWriteStatus,
  type User,
} from '@media-library/contracts';
import type { CatalogRepository, ItemWithStream } from '../catalog/repository';
import type { ProgressRepository } from './repository';

export type RecordResult =
  | { ok: true; status: ProgressWriteStatus; progress: Progress }
  | { ok: false; reason: ProgressRejectReason };

interface Deps {
  repository: ProgressRepository;
  catalog: CatalogRepository;
  now?: () => Date;
}

export function createProgressService({ repository, catalog, now = () => new Date() }: Deps) {
  /**
   * Validates one event against the catalog, the user's entitlements and the server clock, then
   * hands it to the idempotent LWW upsert. `findItem` is injectable so a batch looks each item up once.
   */
  function record(
    user: User,
    itemId: string,
    event: ProgressEventFields,
    findItem: (id: string) => ItemWithStream | undefined = catalog.findItem,
  ): RecordResult {
    const found = findItem(itemId);
    if (!found) return { ok: false, reason: 'unknown_item' };
    if (!canWatch(user.tier, found.requiredTier)) return { ok: false, reason: 'forbidden' };

    const receivedAt = now();
    const recordedAt = new Date(event.recordedAt);
    // A device clock far in the future would otherwise win every future comparison.
    if (recordedAt.getTime() - receivedAt.getTime() > PROGRESS_MAX_CLOCK_SKEW_MS) {
      return { ok: false, reason: 'clock_skew' };
    }

    const { status, progress } = repository.recordEvent({
      userId: user.id,
      itemId,
      eventId: event.eventId,
      positionSec: Math.min(event.positionSec, found.item.durationSec),
      recordedAt,
      deviceId: event.deviceId,
      receivedAt,
    });
    return { ok: true, status, progress };
  }

  function recordBatch(user: User, events: (ProgressEventFields & { itemId: string })[]) {
    const items = new Map<string, ItemWithStream | undefined>();
    const findItem = (id: string) => {
      if (!items.has(id)) items.set(id, catalog.findItem(id));
      return items.get(id);
    };
    return events.map((event) => ({
      eventId: event.eventId,
      result: record(user, event.itemId, event, findItem),
    }));
  }

  return {
    record,
    recordBatch,
    list: (userId: string, query: { itemIds?: string[]; limit: number }) =>
      repository.listProgress(userId, query),
  };
}

export type ProgressService = ReturnType<typeof createProgressService>;
