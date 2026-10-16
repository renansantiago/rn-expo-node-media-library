import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/**
 * `null` means "not determined yet" (e.g. right after launch); treat it as online so the app never
 * shows a false offline state, and let real request failures speak for themselves.
 */
export const isOnlineState = (state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>) =>
  state.isConnected !== false && state.isInternetReachable !== false;

/**
 * Feeds NetInfo into TanStack Query's online manager: while offline, queries pause instead of
 * failing, and they resume (refetch) automatically when connectivity returns.
 */
export function connectNetworkToQueries(
  netInfo: Pick<typeof NetInfo, 'addEventListener'> = NetInfo,
) {
  onlineManager.setEventListener((setOnline) =>
    netInfo.addEventListener((state) => setOnline(isOnlineState(state))),
  );
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
}
