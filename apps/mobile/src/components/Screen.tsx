import type { ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';
import { colors } from './theme';

const STATIC_EDGES: Edge[] = ['bottom', 'left', 'right'];
const SCROLLABLE_EDGES: Edge[] = ['left', 'right'];

interface Props {
  children: ReactNode;
  /**
   * Scrollable screens skip the bottom edge and pad their content with
   * `useSafeAreaInsets().bottom` instead, so rows scroll under the home indicator.
   */
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Root container for stack screens. The opaque native header already covers the top inset, so
 * this only pads the remaining edges (home indicator, gesture bar, landscape notch).
 */
export function Screen({ children, scrollable = false, style }: Props) {
  return (
    <SafeAreaView
      edges={scrollable ? SCROLLABLE_EDGES : STATIC_EDGES}
      style={[styles.screen, style]}
    >
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
});
