import type { VideoPlayer } from 'expo-video';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { SaveReason } from './ProgressProvider';

/** Periodic save cadence while playing. */
export const SAVE_INTERVAL_MS = 10_000;
/**
 * `timeUpdate` cadence the player must be configured with (see VideoPlayer); also how stale the
 * position saved on exit can be.
 */
export const TIME_UPDATE_INTERVAL_SEC = 1;
/** A jump larger than this between two time updates is treated as a seek. */
export const SEEK_THRESHOLD_SEC = 3;
/** Saves closer than this to the previous one are skipped (unless forced). */
const MIN_DELTA_SEC = 1;
/** Time updates ignored while waiting for the resume seek to land. */
const MAX_UNSETTLED_UPDATES = 5;

interface Options {
  player: VideoPlayer;
  durationSec: number;
  /** Position playback started from; seeding with it avoids saving the resume seek itself. */
  startAtSec: number;
  onSave: (positionSec: number, reason: SaveReason) => void;
}

/**
 * Decides *when* to save progress; storage and sync live behind `onSave`.
 * Saves every 10s while playing, on pause, after a seek, at the end, when the app leaves the
 * foreground (the OS may kill it next) and when the player unmounts.
 */
export function useProgressTracker({ player, durationSec, startAtSec, onSave }: Options) {
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    let lastKnown = startAtSec;
    let lastSaved: number | null = startAtSec;
    let settled = startAtSec === 0;
    let ignoredUpdates = 0;

    const save = (reason: SaveReason, position = lastKnown, force = false) => {
      if (!force && lastSaved !== null && Math.abs(position - lastSaved) < MIN_DELTA_SEC) return;
      lastSaved = position;
      onSaveRef.current(position, reason);
    };

    const subscriptions = [
      player.addListener('timeUpdate', ({ currentTime }) => {
        const jumped =
          Math.abs(currentTime - lastKnown) > TIME_UPDATE_INTERVAL_SEC + SEEK_THRESHOLD_SEC;
        if (!settled) {
          // Until the resume seek lands, updates still report the pre-seek time (usually 0);
          // trusting them would overwrite real progress. Give up waiting after a few updates.
          if (jumped && ++ignoredUpdates <= MAX_UNSETTLED_UPDATES) return;
          settled = true;
        }
        lastKnown = currentTime;
        if (jumped) save('seek');
      }),
      player.addListener('playingChange', ({ isPlaying }) => {
        if (!isPlaying) save('pause');
      }),
      player.addListener('playToEnd', () => {
        lastKnown = durationSec;
        save('ended', durationSec, true);
      }),
      AppState.addEventListener('change', (state) => {
        if (state !== 'active') save('background');
      }),
    ];

    const interval = setInterval(() => {
      if (player.playing) save('interval');
    }, SAVE_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      subscriptions.forEach((subscription) => subscription.remove());
      // Uses the last time update: the native player may already be released at this point.
      save('exit');
    };
  }, [durationSec, player, startAtSec]);
}
