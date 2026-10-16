import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { UserFacingError } from '../lib/user-facing-error';
import { Button } from './Button';
import { colors, spacing } from './theme';

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

export function EmptyView({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

interface ErrorViewProps {
  error: UserFacingError;
  onRetry?: () => void;
  /** Overrides the default "Try again" action (e.g. "Sign in"). */
  action?: { title: string; onPress: () => void };
}

export function ErrorView({ error, onRetry, action }: ErrorViewProps) {
  const resolved = action ?? (onRetry ? { title: 'Try again', onPress: onRetry } : undefined);
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Text style={styles.title}>{error.title}</Text>
      <Text style={styles.message}>{error.message}</Text>
      {error.reference ? <Text style={styles.reference}>Ref: {error.reference}</Text> : null}
      {resolved ? (
        <View style={styles.action}>
          <Button title={resolved.title} onPress={resolved.onPress} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  title: { fontSize: 18, fontWeight: '600', color: colors.text, textAlign: 'center' },
  message: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  reference: { fontSize: 12, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  action: { marginTop: spacing.md },
});
