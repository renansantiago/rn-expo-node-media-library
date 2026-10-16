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

// Native video is not available under Jest: a minimal player double that is always ready.
jest.mock('expo-video', () => {
  const { createElement, useMemo } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    useVideoPlayer: (_source: unknown, setup?: (player: unknown) => void) =>
      useMemo(() => {
        const player = {
          status: 'readyToPlay',
          playing: false,
          currentTime: 0,
          play: jest.fn(),
          pause: jest.fn(),
          addListener: () => ({ remove: () => undefined }),
        };
        setup?.(player);
        return player;
        // Like the real hook: one player per mount, regardless of the inline setup callback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []),
    VideoView: (props: { testID?: string }) => createElement(View, { testID: props.testID }),
  };
});

// Any request without a handler fails the test instead of silently hitting the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetFakeApi();
});
afterAll(() => server.close());
