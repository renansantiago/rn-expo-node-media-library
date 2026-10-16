import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../components/theme';
import { useAuth } from './AuthProvider';

interface Props {
  onSignIn: () => void;
  onOpenAccount: () => void;
}

export function AccountButton({ onSignIn, onOpenAccount }: Props) {
  const { status, user } = useAuth();
  if (status === 'restoring') return null;
  const label = user ? user.displayName : 'Sign in';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={user ? `Account: ${user.displayName}` : 'Sign in'}
      onPress={user ? onOpenAccount : onSignIn}
      hitSlop={8}
      style={styles.button}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: spacing.xs },
  text: { color: colors.accent, fontSize: 16, fontWeight: '600' },
});
