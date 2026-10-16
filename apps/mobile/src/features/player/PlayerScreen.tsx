import { useCallback } from 'react';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useAuth } from '../auth/AuthProvider';
import { useItem } from '../catalog/api';
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
  const access = usePlaybackAccess(itemId);
  const item = useItem(itemId);
  const resume = useResumePosition(itemId);
  const { record, storeStatus } = useProgressContext();
  const resolvingResume =
    storeStatus === 'opening' || (storeStatus === 'ready' && resume.isPending);

  const durationSec = item.data?.durationSec ?? 0;
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
  if (access.error) {
    return (
      <ErrorView error={toUserFacingError(access.error)} onRetry={() => void access.refetch()} />
    );
  }
  if (item.error && !item.data) {
    return <ErrorView error={toUserFacingError(item.error)} onRetry={() => void item.refetch()} />;
  }
  if (status === 'restoring' || access.isPending || !item.data || resolvingResume) {
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
