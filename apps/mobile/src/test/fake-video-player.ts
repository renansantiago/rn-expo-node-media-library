import type { VideoPlayer } from 'expo-video';

type Listener = (payload?: unknown) => void;

/**
 * Stand-in for expo-video's native player: plain state plus an event emitter, so tests can drive
 * `timeUpdate`, `playingChange` and `playToEnd` exactly like the native side would.
 */
export function createFakeVideoPlayer(initial: { status?: string } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const player = {
    status: initial.status ?? 'readyToPlay',
    playing: false,
    currentTime: 0,
    timeUpdateEventInterval: 0,
    play: jest.fn(() => {
      player.playing = true;
    }),
    pause: jest.fn(() => {
      player.playing = false;
    }),
    addListener(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return { remove: () => set.delete(listener) };
    },
    emit(event: string, payload?: unknown) {
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
  return player;
}

export type FakeVideoPlayer = ReturnType<typeof createFakeVideoPlayer>;

export const asVideoPlayer = (fake: FakeVideoPlayer) => fake as unknown as VideoPlayer;

/** Players created through the mocked `useVideoPlayer`, newest last. */
export const createdPlayers: FakeVideoPlayer[] = [];
