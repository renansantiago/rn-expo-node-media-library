import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsOnline } from '../lib/network';
import { colors, spacing } from './theme';

/** App-wide notice while offline; screens keep showing cached content underneath. */
export function OfflineBanner() {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View
      style={[styles.banner, { paddingBottom: spacing.sm + insets.bottom }]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      pointerEvents="none"
    >
      <Text style={styles.text}>
        You&apos;re offline. Showing saved content; progress syncs when you reconnect.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.text,
  },
  text: { color: colors.background, fontSize: 13, textAlign: 'center' },
});
