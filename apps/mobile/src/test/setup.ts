import { onlineManager } from '@tanstack/react-query';
import { createdPlayers } from './fake-video-player';
import { resetFakeApi, server } from './server';

// SafeAreaProvider renders nothing until native insets arrive; use the library's static mock.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

// jest-expo auto-mocks native modules (randomUUID would return undefined); use Node's implementation.
jest.mock('expo-crypto', () => ({
  randomUUID: () => jest.requireActual('node:crypto').randomUUID(),
}));

// Native video is not available under Jest: an always-ready player double that tests can drive.
jest.mock('expo-video', () => {
  const { createElement, useMemo } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const { createFakeVideoPlayer, createdPlayers } = jest.requireActual('./fake-video-player');
  return {
    useVideoPlayer: (_source: unknown, setup?: (player: unknown) => void) =>
      useMemo(() => {
        const player = createFakeVideoPlayer();
        createdPlayers.push(player);
        setup?.(player);
        return player;
        // Like the real hook: one player per mount, regardless of the inline setup callback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []),
    VideoView: (props: { testID?: string }) => createElement(View, { testID: props.testID }),
  };
});

// Native storage and connectivity modules: use the libraries' official Jest mocks.
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock'),
);

// Icon fonts are bundled assets Jest can't load; render the glyph name instead.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { createElement } = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => createElement(Text, null, name),
  };
});

// Any request without a handler fails the test instead of silently hitting the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetFakeApi();
  createdPlayers.length = 0;
  onlineManager.setOnline(true);
});
afterAll(() => server.close());
