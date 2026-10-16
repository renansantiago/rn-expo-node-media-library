import { ErrorView, LoadingView } from '../../components/StateViews';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useAuth } from '../auth/AuthProvider';
import { usePlaybackAccess } from './api';
import { VideoPlayer } from './VideoPlayer';

interface Props {
  itemId: string;
  onSignIn: () => void;
}

export function PlayerScreen({ itemId, onSignIn }: Props) {
  const { status } = useAuth();
  const access = usePlaybackAccess(itemId);

  if (status === 'signedOut') {
    return (
      <ErrorView
        error={{ title: 'Sign in required', message: 'Sign in to watch this video.' }}
        action={{ title: 'Sign in', onPress: onSignIn }}
      />
    );
  }
  if (status === 'restoring' || access.isPending) return <LoadingView label="Preparing video" />;
  if (access.error) {
    return (
      <ErrorView error={toUserFacingError(access.error)} onRetry={() => void access.refetch()} />
    );
  }
  return <VideoPlayer streamUrl={access.data.streamUrl} onRetry={() => void access.refetch()} />;
}
