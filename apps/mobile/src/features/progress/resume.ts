import { isCompleted } from '@media-library/contracts';

/** Below this, starting over is friendlier than resuming a few seconds in. */
export const MIN_RESUME_SEC = 5;

/**
 * Where playback should start. The local store already holds the winner of the multi-device rule
 * (local saves merged with the latest server state), so this only decides whether it is worth resuming.
 */
export function resumePositionSec(
  progress: { positionSec: number; durationSec: number } | null | undefined,
): number {
  if (!progress) return 0;
  if (progress.positionSec < MIN_RESUME_SEC) return 0;
  if (isCompleted(progress.positionSec, progress.durationSec)) return 0;
  return progress.positionSec;
}
