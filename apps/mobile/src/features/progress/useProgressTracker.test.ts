import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { asVideoPlayer, createFakeVideoPlayer } from '../../test/fake-video-player';
import { SAVE_INTERVAL_MS, useProgressTracker } from './useProgressTracker';

const DURATION = 600;

async function setup(startAtSec = 0) {
  const appStateListeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  const player = createFakeVideoPlayer();
  const onSave = jest.fn();
  const hook = await renderHook(() =>
    useProgressTracker({
      player: asVideoPlayer(player),
      durationSec: DURATION,
      startAtSec,
      onSave,
    }),
  );
  /** Simulates `seconds` of playback, one time update per second (like the native player). */
  const play = async (from: number, seconds: number) => {
    player.playing = true;
    for (let t = from + 1; t <= from + seconds; t++) {
      await act(async () => {
        player.currentTime = t;
        player.emit('timeUpdate', { currentTime: t });
        jest.advanceTimersByTime(1_000);
      });
    }
  };
  const setAppState = (state: AppStateStatus) =>
    act(async () => appStateListeners.forEach((listener) => listener(state)));
  return { player, onSave, hook, play, setAppState };
}

describe('useProgressTracker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('saves every 10 seconds while playing, and not while paused', async () => {
    const { player, onSave, play } = await setup();
    await play(0, 25);
    expect(onSave.mock.calls).toEqual([
      [10, 'interval'],
      [20, 'interval'],
    ]);

    player.playing = false;
    await act(async () => jest.advanceTimersByTime(SAVE_INTERVAL_MS * 3));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('saves on pause, skipping saves that would not change anything', async () => {
    const { player, onSave, play } = await setup();
    await play(0, 4);
    await act(async () => player.emit('playingChange', { isPlaying: false }));
    expect(onSave).toHaveBeenLastCalledWith(4, 'pause');

    await act(async () => player.emit('playingChange', { isPlaying: false }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves after a seek', async () => {
    const { player, onSave, play } = await setup();
    await play(0, 3);
    await act(async () => player.emit('timeUpdate', { currentTime: 200 }));
    expect(onSave).toHaveBeenLastCalledWith(200, 'seek');
  });

  it('saves the full duration when playback ends, even if nothing else changed', async () => {
    const { player, onSave } = await setup(DURATION);
    await act(async () => player.emit('playToEnd'));
    expect(onSave).toHaveBeenLastCalledWith(DURATION, 'ended');
  });

  it('saves when the app leaves the foreground (the OS may kill it next)', async () => {
    const { onSave, play, setAppState } = await setup();
    await play(0, 7);
    await setAppState('background');
    expect(onSave).toHaveBeenLastCalledWith(7, 'background');
    await setAppState('active');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('saves the last known position on unmount and unsubscribes from the player', async () => {
    const { player, onSave, hook, play } = await setup();
    await play(0, 5);
    await hook.unmount();
    expect(onSave).toHaveBeenLastCalledWith(5, 'exit');
    expect(player.listenerCount('timeUpdate')).toBe(0);
  });

  describe('when resuming', () => {
    it('does not mistake the resume seek for user progress', async () => {
      const { player, onSave, hook } = await setup(300);
      // Before the seek lands, the native player still reports the start of the stream.
      await act(async () => player.emit('timeUpdate', { currentTime: 0 }));
      await act(async () => player.emit('timeUpdate', { currentTime: 0.5 }));
      expect(onSave).not.toHaveBeenCalled();

      await act(async () => player.emit('timeUpdate', { currentTime: 301 }));
      await hook.unmount();
      expect(onSave.mock.calls).toEqual([[301, 'exit']]);
    });

    it('starts trusting the player if the resume seek never lands', async () => {
      const { player, onSave } = await setup(300);
      for (let t = 0; t < 6; t++) {
        await act(async () => player.emit('timeUpdate', { currentTime: t }));
      }
      expect(onSave).toHaveBeenCalledWith(5, 'seek');
    });
  });
});
