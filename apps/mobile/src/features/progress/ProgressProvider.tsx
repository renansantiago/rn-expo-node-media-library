import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useApiClient } from '../../lib/api';
import { openAppDatabase, type SqlDatabase } from '../../lib/db/database';
import { logger } from '../../lib/logger';
import { useAuth } from '../auth/AuthProvider';
import { createProgressStore, type ProgressStore } from './store';
import { createProgressSync, type ProgressSync } from './sync';

export type SaveReason = 'interval' | 'pause' | 'seek' | 'ended' | 'background' | 'exit';

interface ProgressContextValue {
  /** `failed` means progress is unavailable on this device; playback still works without it. */
  storeStatus: 'opening' | 'ready' | 'failed';
  /** Null until the on-device database is open (or if it failed to open). */
  store: ProgressStore | null;
  /** Null while signed out. */
  sync: ProgressSync | null;
  userId: string | null;
  /** Saves locally first, then tries to deliver. Never throws: progress must not break playback. */
  record(input: {
    itemId: string;
    positionSec: number;
    durationSec: number;
    reason: SaveReason;
  }): Promise<void>;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

export const progressKeys = {
  all: (userId: string | null) => ['user', userId, 'progress'] as const,
  /** Reads of the local store; invalidated whenever it changes. */
  local: (userId: string | null) => [...progressKeys.all(userId), 'local'] as const,
  list: (userId: string | null) => [...progressKeys.local(userId), 'list'] as const,
  item: (userId: string | null, itemId: string) =>
    [...progressKeys.local(userId), 'item', itemId] as const,
  /** Computed once per player mount; deliberately outside `local` so saves don't refetch it. */
  resume: (userId: string | null, itemId: string) =>
    [...progressKeys.all(userId), 'resume', itemId] as const,
};

interface Props {
  children: ReactNode;
  /** Injection point for tests (in-memory SQLite). */
  openDatabase?: () => Promise<SqlDatabase>;
}

export function ProgressProvider({ children, openDatabase = openAppDatabase }: Props) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [store, setStore] = useState<ProgressStore | null>(null);
  const [storeFailed, setStoreFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openDatabase()
      .then((db) => {
        if (!cancelled) setStore(createProgressStore(db));
      })
      .catch((err) => {
        logger.error('progress.db_open_failed', { err });
        if (!cancelled) setStoreFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [openDatabase]);

  // Keep every screen that reads local progress in sync with the store.
  useEffect(
    () =>
      store?.subscribe((changedUserId) => {
        void queryClient.invalidateQueries({ queryKey: progressKeys.local(changedUserId) });
      }),
    [queryClient, store],
  );

  const sync = useMemo(
    () => (store && userId ? createProgressSync({ store, client, userId, logger }) : null),
    [client, store, userId],
  );

  // On sign-in / launch, and whenever the app returns to the foreground: deliver what is queued
  // (e.g. saved while offline or just before the app was killed) and pick up other devices' progress.
  useEffect(() => {
    if (!sync) return;
    const catchUp = () => {
      void sync.flush();
      sync.pull().catch((err) => logger.debug('progress.pull_failed', { err }));
    };
    catchUp();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    return () => {
      subscription.remove();
      sync.dispose();
    };
  }, [sync]);

  const record = useCallback<ProgressContextValue['record']>(
    async ({ reason, ...input }) => {
      if (!store || !userId) return;
      try {
        const entry = await store.record(userId, input);
        logger.debug('progress.saved', {
          itemId: input.itemId,
          positionSec: entry.positionSec,
          reason,
        });
        void sync?.flush();
      } catch (err) {
        logger.error('progress.save_failed', { err, itemId: input.itemId });
      }
    },
    [store, sync, userId],
  );

  const storeStatus = store ? 'ready' : storeFailed ? 'failed' : 'opening';
  const value = useMemo(
    () => ({ storeStatus, store, sync, userId, record }) as const,
    [record, store, storeStatus, sync, userId],
  );
  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgressContext(): ProgressContextValue {
  const value = useContext(ProgressContext);
  if (!value) throw new Error('useProgressContext must be used inside <ProgressProvider>');
  return value;
}
