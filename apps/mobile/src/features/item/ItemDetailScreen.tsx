import { canWatch, type Item, type User } from '@media-library/contracts';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { ProgressBar } from '../../components/ProgressBar';
import { TierBadge } from '../../components/TierBadge';
import { colors, spacing } from '../../components/theme';
import { formatDuration } from '../../lib/format';
import { OFFLINE_ERROR, toUserFacingError } from '../../lib/user-facing-error';
import { useAuth, type AuthStatus } from '../auth/AuthProvider';
import { useCachedItem, useItem } from '../catalog/api';
import { useItemProgress } from '../progress/hooks';
import { resumePositionSec } from '../progress/resume';

interface Props {
  itemId: string;
  onPlay: (id: string) => void;
  onSignIn: () => void;
}

export function ItemDetailScreen({ itemId, onPlay, onSignIn }: Props) {
  const { data, error, isPending, fetchStatus, refetch } = useItem(itemId);
  // If the request fails, keep showing what the catalog already saved for this item.
  const saved = useCachedItem(itemId, !data);
  const item = data ?? saved;
  const showingSaved = !data && !!saved && !!error;
  const { status, user } = useAuth();
  const insets = useSafeAreaInsets();
  const progress = useItemProgress(itemId);
  const resumeAt = resumePositionSec(progress.data);

  if (!item && isPending && fetchStatus === 'paused') return <ErrorView error={OFFLINE_ERROR} />;
  if (!item && isPending) return <LoadingView label="Loading details" />;
  if (!item) {
    return <ErrorView error={toUserFacingError(error)} onRetry={() => void refetch()} />;
  }

  return (
    <Screen scrollable>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xl + insets.bottom }}>
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={styles.hero}
            contentFit="cover"
            cachePolicy="disk"
            transition={150}
          />
        ) : (
          <View style={styles.hero} />
        )}
        <View style={styles.body}>
          {showingSaved ? (
            <View style={styles.savedNotice} accessible accessibilityRole="alert">
              <Text style={styles.savedText}>
                Couldn&apos;t refresh these details. Showing what&apos;s saved on this device.
              </Text>
              <Button title="Retry" variant="secondary" onPress={() => void refetch()} />
            </View>
          ) : null}
          <Text style={styles.title} accessibilityRole="header">
            {item.title}
          </Text>
          <Text style={styles.meta}>
            {item.category.name} · {formatDuration(item.durationSec)}
          </Text>
          <TierBadge tier={item.requiredTier} />
          {resumeAt > 0 ? (
            <View style={styles.progress}>
              <ProgressBar
                value={resumeAt / item.durationSec}
                label={`Watched ${formatDuration(resumeAt)} of ${formatDuration(item.durationSec)}`}
              />
              <Text style={styles.progressText}>
                {formatDuration(item.durationSec - resumeAt)} left
              </Text>
            </View>
          ) : null}
          <PlayAction
            item={item}
            status={status}
            user={user}
            resumeAt={resumeAt}
            onPlay={() => onPlay(item.id)}
            onSignIn={onSignIn}
          />
          <Text style={styles.description}>{item.description}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

interface PlayActionProps {
  item: Item;
  status: AuthStatus;
  user: User | null;
  resumeAt: number;
  onPlay: () => void;
  onSignIn: () => void;
}

/** The API is the authority on entitlements; this only avoids offering a doomed "Play". */
function PlayAction({ item, status, user, resumeAt, onPlay, onSignIn }: PlayActionProps) {
  if (status === 'restoring') return <Button title="Play" onPress={onPlay} loading />;
  if (!user) return <Button title="Sign in to watch" onPress={onSignIn} />;
  if (!canWatch(user.tier, item.requiredTier)) {
    return (
      <View style={styles.notice} accessibilityRole="alert">
        <Text style={styles.noticeTitle}>Included with Premium</Text>
        <Text style={styles.noticeText}>
          You&apos;re on the Free plan. Upgrade to watch this title.
        </Text>
      </View>
    );
  }
  return (
    <Button
      title={resumeAt > 0 ? `Resume from ${formatDuration(resumeAt)}` : 'Play'}
      onPress={onPlay}
    />
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface },
  body: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  description: { fontSize: 16, lineHeight: 22, color: colors.text },
  progress: { gap: spacing.xs },
  savedNotice: {
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  savedText: { fontSize: 14, color: colors.text },
  progressText: { fontSize: 13, color: colors.textMuted },
  notice: {
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.premiumBg,
    gap: spacing.xs,
  },
  noticeTitle: { fontWeight: '700', color: colors.premium },
  noticeText: { color: colors.text },
});
