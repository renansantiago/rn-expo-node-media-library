import { canWatch, type Item, type User } from '@media-library/contracts';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { ErrorView, LoadingView } from '../../components/StateViews';
import { TierBadge } from '../../components/TierBadge';
import { colors, spacing } from '../../components/theme';
import { formatDuration } from '../../lib/format';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useAuth, type AuthStatus } from '../auth/AuthProvider';
import { useItem } from '../catalog/api';

interface Props {
  itemId: string;
  onPlay: (id: string) => void;
  onSignIn: () => void;
}

export function ItemDetailScreen({ itemId, onPlay, onSignIn }: Props) {
  const { data: item, error, isPending, refetch } = useItem(itemId);
  const { status, user } = useAuth();
  const insets = useSafeAreaInsets();

  if (isPending) return <LoadingView label="Loading details" />;
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
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.hero} />
        )}
        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">
            {item.title}
          </Text>
          <Text style={styles.meta}>
            {item.category.name} · {formatDuration(item.durationSec)}
          </Text>
          <TierBadge tier={item.requiredTier} />
          <PlayAction
            item={item}
            status={status}
            user={user}
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
  onPlay: () => void;
  onSignIn: () => void;
}

/** The API is the authority on entitlements; this only avoids offering a doomed "Play". */
function PlayAction({ item, status, user, onPlay, onSignIn }: PlayActionProps) {
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
  return <Button title="Play" onPress={onPlay} />;
}

const styles = StyleSheet.create({
  hero: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface },
  body: { padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  meta: { fontSize: 15, color: colors.textMuted },
  description: { fontSize: 16, lineHeight: 22, color: colors.text },
  notice: {
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.premiumBg,
    gap: spacing.xs,
  },
  noticeTitle: { fontWeight: '700', color: colors.premium },
  noticeText: { color: colors.text },
});
