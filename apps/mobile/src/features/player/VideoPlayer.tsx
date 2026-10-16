import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet, View } from 'react-native';
import { ErrorView } from '../../components/StateViews';
import { logger } from '../../lib/logger';

interface Props {
  streamUrl: string;
  onRetry: () => void;
}

export function VideoPlayer({ streamUrl, onRetry }: Props) {
  const player = useVideoPlayer(streamUrl, (p) => p.play());
  const { status, error } = useEvent(player, 'statusChange', { status: player.status });

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
