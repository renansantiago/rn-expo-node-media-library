import { useCallback } from 'react';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { useIsOnline } from '../../lib/network';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useAuth } from '../auth/AuthProvider';
import { useCachedItem, useItem } from '../catalog/api';
import { useResumePosition } from '../progress/hooks';
import { useProgressContext, type SaveReason } from '../progress/ProgressProvider';
import { usePlaybackAccess } from './api';
import { VideoPlayer } from './VideoPlayer';

interface Props {
  itemId: string;
  onSignIn: () => void;
}

export function PlayerScreen({ itemId, onSignIn }: Props) {
  const { status } = useAuth();
  const online = useIsOnline();
  const access = usePlaybackAccess(itemId);
  const item = useItem(itemId);
  const resume = useResumePosition(itemId);
  const { record, storeStatus } = useProgressContext();
  const resolvingResume =
    storeStatus === 'opening' || (storeStatus === 'ready' && resume.isPending);

  // Only the duration is needed here, so details saved by the catalog are good enough.
  const saved = useCachedItem(itemId, !item.data);
  const details = item.data ?? saved;
  const durationSec = details?.durationSec ?? 0;
  const onProgress = useCallback(
    (positionSec: number, reason: SaveReason) =>
      void record({ itemId, positionSec, durationSec, reason }),
    [durationSec, itemId, record],
  );

  if (status === 'signedOut') {
    return (
      <ErrorView
        error={{ title: 'Sign in required', message: 'Sign in to watch this video.' }}
        action={{ title: 'Sign in', onPress: onSignIn }}
      />
    );
  }
  // A playback grant needs the server; don't start (or keep spinning) without one.
  if (!online && !access.data) {
    return (
      <ErrorView
        error={{
          title: "You're offline",
          message:
            'Playback needs an internet connection. Your progress is saved on this device and syncs when you reconnect.',
        }}
      />
    );
  }
  if (access.error) {
    return (
      <ErrorView error={toUserFacingError(access.error)} onRetry={() => void access.refetch()} />
    );
  }
  if (item.error && !details) {
    return <ErrorView error={toUserFacingError(item.error)} onRetry={() => void item.refetch()} />;
  }
  if (status === 'restoring' || access.isPending || !details || resolvingResume) {
    return <LoadingView label="Preparing video" />;
  }
  return (
    <VideoPlayer
      streamUrl={access.data.streamUrl}
      durationSec={durationSec}
      startAtSec={resume.data ?? 0}
      onProgress={onProgress}
      onRetry={() => void access.refetch()}
    />
  );
}
