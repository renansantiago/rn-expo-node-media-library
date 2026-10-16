import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { colors, spacing } from '../../components/theme';
import { HttpError } from '../../lib/api';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useAuth } from './AuthProvider';

const EYE_ICON_SIZE = 22;

interface Props {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: Props) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = username.trim().length > 0 && password.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await login({ username: username.trim(), password });
      onSuccess();
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        setError('Invalid username or password.');
      } else if (err instanceof HttpError && err.status === 429) {
        const wait = Math.ceil((err.retryAfterMs ?? 60_000) / 1000);
        setError(`Too many sign-in attempts. Try again in ${wait} seconds.`);
      } else {
        const friendly = toUserFacingError(err);
        setError(`${friendly.message}${friendly.reference ? ` (Ref: ${friendly.reference})` : ''}`);
      }
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.form}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            accessibilityLabel="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            style={styles.input}
          />
          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordField}>
            <TextInput
              accessibilityLabel="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!passwordVisible}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              style={[styles.input, styles.passwordInput]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
              onPress={() => setPasswordVisible((visible) => !visible)}
              hitSlop={spacing.sm}
              style={styles.visibilityToggle}
            >
              <Ionicons
                name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                size={EYE_ICON_SIZE}
                color={colors.textMuted}
              />
            </Pressable>
          </View>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Button
            title="Sign in"
            onPress={() => void submit()}
            disabled={!canSubmit}
            loading={submitting}
          />
          <Text style={styles.hint}>
            Demo accounts: free-user and premium-user (password set in the API configuration).
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  form: { padding: spacing.xl, gap: spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  passwordField: { justifyContent: 'center' },
  // Keeps typed text clear of the eye button.
  passwordInput: { paddingRight: spacing.md * 2 + EYE_ICON_SIZE },
  visibilityToggle: { position: 'absolute', right: spacing.md },
  error: { color: colors.danger, marginVertical: spacing.sm },
  hint: { marginTop: spacing.lg, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
});
