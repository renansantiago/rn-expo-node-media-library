import { useEvent } from 'expo';
import { useVideoPlayer, VideoView, type VideoPlayer as NativePlayer } from 'expo-video';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { ErrorView } from '../../components/StateViews';
import { logger } from '../../lib/logger';
import type { SaveReason } from '../progress/ProgressProvider';
import { TIME_UPDATE_INTERVAL_SEC, useProgressTracker } from '../progress/useProgressTracker';

interface Props {
  streamUrl: string;
  durationSec: number;
  /** Resume point; applied once the stream is ready (seeking earlier is unreliable). */
  startAtSec: number;
  onProgress: (positionSec: number, reason: SaveReason) => void;
  onRetry: () => void;
}

/** Seeks to the resume point (only reliable once the stream is ready) and starts playback. */
function startPlayback(player: NativePlayer, startAtSec: number) {
  if (startAtSec > 0) player.currentTime = startAtSec;
  player.play();
}

export function VideoPlayer({ streamUrl, durationSec, startAtSec, onProgress, onRetry }: Props) {
  const player = useVideoPlayer(streamUrl, (p) => {
    // The progress tracker relies on one time update per second.
    p.timeUpdateEventInterval = TIME_UPDATE_INTERVAL_SEC;
  });
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });
  const started = useRef(false);

  useEffect(() => {
    if (status !== 'readyToPlay' || started.current) return;
    started.current = true;
    startPlayback(player, startAtSec);
    logger.info('player.started', { startAtSec });
  }, [player, startAtSec, status]);

  useProgressTracker({ player, durationSec, startAtSec, onSave: onProgress });

  if (status === 'error') {
    logger.warn('player.error', { message: error?.message });
    return (
      <ErrorView
        error={{
          title: "Can't play this video",
          message: 'The stream could not be loaded. Check your connection and try again.',
        }}
        onRetry={onRetry}
      />
    );
  }

  return (
    <View style={styles.container}>
      <VideoView
        testID="video-view"
        player={player}
        style={styles.video}
        nativeControls
        contentFit="contain"
        allowsPictureInPicture
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', justifyContent: 'center' },
  video: { width: '100%', aspectRatio: 16 / 9 },
});
