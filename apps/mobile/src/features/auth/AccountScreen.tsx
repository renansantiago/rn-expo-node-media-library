import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { EmptyView } from '../../components/StateViews';
import { colors, spacing } from '../../components/theme';
import type { RequestMetrics } from '../../lib/telemetry';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';
import { useAuth } from './AuthProvider';

const PLAN_LABEL = { free: 'Free', premium: 'Premium' } as const;

interface Props {
  onSignedOut: () => void;
  /** Injection point for tests. */
  metrics?: RequestMetrics;
}

export function AccountScreen({ onSignedOut, metrics }: Props) {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) return <EmptyView title="Not signed in" />;

  const signOut = async () => {
    setSigningOut(true);
    await logout();
    onSignedOut();
  };

  return (
    <Screen style={styles.screen}>
      <Text style={styles.name}>{user.displayName}</Text>
      <Text style={styles.detail}>@{user.username}</Text>
      <Text style={styles.detail}>Plan: {PLAN_LABEL[user.tier]}</Text>
      <View style={styles.action}>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => void signOut()}
          loading={signingOut}
        />
      </View>
      <DiagnosticsPanel metrics={metrics} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.xl, gap: spacing.sm },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  detail: { fontSize: 16, color: colors.textMuted },
  action: { marginTop: spacing.xl },
});
