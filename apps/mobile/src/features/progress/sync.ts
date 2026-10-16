import type { Progress } from '@media-library/contracts';
import { HttpError, isRetryable, type ApiClient } from '../../lib/api';
import type { Logger } from '../../lib/logger';
import { fetchProgress, sendProgressBatch } from './api';
import type { OutboxEntry, ProgressStore } from './store';

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60 * 1000;
/** Upper bound of batches per flush; anything left is picked up by the next trigger. */
const MAX_BATCHES_PER_FLUSH = 10;

/** Exponential backoff (2s, 4s, 8s … capped at 5 min) with jitter so devices don't retry in lockstep. */
export const outboxRetryDelay = (attempts: number, random = Math.random) =>
  Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (attempts - 1)) * (0.5 + random() * 0.5);

export type FlushOutcome = 'idle' | 'synced' | 'retry_scheduled' | 'unauthorized';

interface SyncDeps {
  store: ProgressStore;
  client: ApiClient;
  userId: string;
  logger: Logger;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/**
 * Delivers one user's outbox to the API and merges the canonical state it returns.
 *
 * - Single-flight: concurrent `flush()` calls share one run (plus one follow-up if more was queued).
 * - Retryable failures (offline, timeout, 5xx, 429) reschedule the batch with backoff and arm a timer.
 * - Events are removed only once the server has resolved them (applied, stale, duplicate) or
 *   rejected them as permanently invalid; nothing is dropped because of a transport failure.
 */
export function createProgressSync({
  store,
  client,
  userId,
  logger,
  now = () => Date.now(),
  random = Math.random,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: SyncDeps) {
  const log = logger.child({ component: 'progress-sync', userId });
  let running: Promise<FlushOutcome> | null = null;
  let rerun = false;
  let rerunIgnoringBackoff = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  async function armRetryTimer() {
    if (disposed) return;
    const next = await store.nextAttemptAt(userId);
    if (timer) clearTimer(timer);
    timer = null;
    if (next === null || disposed) return;
    timer = setTimer(
      () => {
        timer = null;
        void flush();
      },
      Math.max(0, next - now()),
    );
  }

  async function deliver(entries: OutboxEntry[]): Promise<void> {
    const { results } = await sendProgressBatch(
      client,
      entries.map((entry) => ({
        eventId: entry.eventId,
        itemId: entry.itemId,
        positionSec: entry.positionSec,
        recordedAt: new Date(entry.recordedAt).toISOString(),
        deviceId: entry.deviceId,
      })),
    );

    const canonical: Progress[] = [];
    for (const result of results) {
      if (result.status === 'rejected') {
        // Final: retrying can never succeed (e.g. the item was removed or the plan changed).
        log.warn('progress.event_rejected', { eventId: result.eventId, reason: result.reason });
      } else {
        canonical.push(result.progress);
        if (result.status === 'stale') {
          log.info('progress.superseded', { itemId: result.progress.itemId });
        }
      }
    }
    await store.acknowledge(
      userId,
      results.map((result) => result.eventId),
    );
    await store.applyServerState(userId, canonical);
  }

  async function run(ignoreBackoff: boolean): Promise<FlushOutcome> {
    let delivered = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_FLUSH; batch++) {
      const due = await store.due(userId, { ignoreBackoff });
      if (!due.length) break;
      try {
        await deliver(due);
        delivered += due.length;
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          // The session is being cleared by the API client; events wait for the next sign-in.
          log.warn('progress.flush_unauthorized');
          return 'unauthorized';
        }
        if (!isRetryable(error)) {
          // A 4xx other than 401/408/429 means a client bug; keep the events but back off hard.
          log.error('progress.flush_failed', { err: error, events: due.length });
        } else {
          log.info('progress.flush_deferred', { err: error, events: due.length });
        }
        // Rate limited (or told to come back later): wait exactly as long as the server asks.
        const serverDelay = error instanceof HttpError ? error.retryAfterMs : undefined;
        await store.reschedule(
          userId,
          due.map((entry) => entry.eventId),
          {
            error: error instanceof Error ? error.message : String(error),
            delayMs: (attempts) => serverDelay ?? outboxRetryDelay(attempts, random),
          },
        );
        await armRetryTimer();
        return 'retry_scheduled';
      }
    }
    // Events still waiting on a backoff (newer saves reset theirs) need the timer too.
    await armRetryTimer();
    if (delivered) log.debug('progress.flushed', { events: delivered });
    return delivered ? 'synced' : 'idle';
  }

  /**
   * Delivers due events. `ignoreBackoff` also sends events waiting on a retry delay; use it when
   * the cause of the failures is known to be gone (connectivity restored, app foregrounded).
   */
  function flush({
    ignoreBackoff = false,
  }: { ignoreBackoff?: boolean } = {}): Promise<FlushOutcome> {
    if (disposed) return Promise.resolve('idle');
    if (running) {
      rerun = true;
      rerunIgnoringBackoff ||= ignoreBackoff;
      return running;
    }
    running = (async () => {
      try {
        let outcome = await run(ignoreBackoff);
        let synced = outcome === 'synced';
        while (rerun && outcome !== 'unauthorized' && !disposed) {
          const ignore = rerunIgnoringBackoff;
          rerun = false;
          rerunIgnoringBackoff = false;
          outcome = await run(ignore);
          synced ||= outcome === 'synced';
        }
        // Callers that joined a run care whether their events went out, not about the last pass.
        return outcome === 'idle' && synced ? 'synced' : outcome;
      } finally {
        running = null;
        rerun = false;
        rerunIgnoringBackoff = false;
      }
    })();
    return running;
  }

  /** Pulls canonical state (other devices' progress) and merges it into the local store. */
  async function pull(itemIds?: string[], options?: { timeoutMs?: number }): Promise<void> {
    const { data } = await fetchProgress(client, itemIds ? { itemIds } : { limit: 50 }, options);
    await store.applyServerState(userId, data);
  }

  return {
    flush,
    pull,
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

export type ProgressSync = ReturnType<typeof createProgressSync>;
