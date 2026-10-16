import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { logger } from '../../lib/logger';
import { progressKeys, useProgressContext } from './ProgressProvider';
import { resumePositionSec } from './resume';
import type { LocalProgress } from './store';

/** How long the player waits for the server's latest position before resuming from local state. */
export const RESUME_PULL_TIMEOUT_MS = 3_000;

/** All local progress for the signed-in user, keyed by item id (catalog rows). */
export function useProgressMap() {
  const { store, userId } = useProgressContext();
  return useQuery({
    queryKey: progressKeys.list(userId),
    queryFn: () => store!.list(userId!),
    enabled: !!store && !!userId,
    select: (rows) => new Map<string, LocalProgress>(rows.map((row) => [row.itemId, row])),
    staleTime: Infinity,
  });
}

/** One item's local progress, refreshed in the background from the server (detail screen). */
export function useItemProgress(itemId: string) {
  const { store, sync, userId } = useProgressContext();

  useEffect(() => {
    sync?.pull([itemId]).catch((err) => logger.debug('progress.pull_failed', { err, itemId }));
  }, [itemId, sync]);

  return useQuery({
    queryKey: progressKeys.item(userId, itemId),
    queryFn: () => store!.get(userId!, itemId),
    enabled: !!store && !!userId,
    staleTime: Infinity,
  });
}

/**
 * Start position for the player: pull the server's latest state (briefly, so another device's newer
 * position wins), merge it under the multi-device rule, then read the local winner. Offline or slow
 * networks fall back to local progress, which already includes this device's unsynced saves.
 */
export function useResumePosition(itemId: string) {
  const { store, sync, userId } = useProgressContext();
  return useQuery({
    queryKey: progressKeys.resume(userId, itemId),
    queryFn: async () => {
      await sync
        ?.pull([itemId], { timeoutMs: RESUME_PULL_TIMEOUT_MS })
        .catch((err) => logger.info('progress.resume_offline', { err, itemId }));
      return resumePositionSec(await store!.get(userId!, itemId));
    },
    enabled: !!store && !!userId,
    // Computed once per player session; saves while watching must not move the start point.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}
