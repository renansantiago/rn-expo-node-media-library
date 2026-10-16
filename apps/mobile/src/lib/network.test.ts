import type { NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { connectNetworkToQueries, isOnlineState, useIsOnline } from './network';

describe('isOnlineState', () => {
  it.each([
    [{ isConnected: true, isInternetReachable: true }, true],
    [{ isConnected: true, isInternetReachable: null }, true], // reachability not probed yet
    [{ isConnected: null, isInternetReachable: null }, true], // unknown at launch: don't flash "offline"
    [{ isConnected: true, isInternetReachable: false }, false], // captive portal / no route
    [{ isConnected: false, isInternetReachable: null }, false],
  ])('%j → %s', (state, expected) => {
    expect(isOnlineState(state)).toBe(expected);
  });
});

describe('connectNetworkToQueries', () => {
  afterEach(() => {
    // Restore the default (always online) listener for other tests.
    onlineManager.setEventListener(() => () => undefined);
    onlineManager.setOnline(true);
  });

  it('drives the query online state from NetInfo and exposes it to components', async () => {
    let emit!: (state: Partial<NetInfoState>) => void;
    const unsubscribe = jest.fn();
    connectNetworkToQueries({
      addEventListener: (listener) => {
        emit = (state) => listener(state as NetInfoState);
        return unsubscribe;
      },
    });

    const { result } = await renderHook(() => useIsOnline());
    expect(result.current).toBe(true);

    await act(async () => emit({ isConnected: false, isInternetReachable: false }));
    expect(onlineManager.isOnline()).toBe(false);
    expect(result.current).toBe(false);

    await act(async () => emit({ isConnected: true, isInternetReachable: true }));
    expect(result.current).toBe(true);
  });
});
