import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from './theme';

interface Props {
  /** 0..1 */
  value: number;
  label: string;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ value, label, style }: Props) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      style={[styles.track, style]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
});
