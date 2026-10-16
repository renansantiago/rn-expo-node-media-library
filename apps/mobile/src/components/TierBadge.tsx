import type { Tier } from '@media-library/contracts';
import { StyleSheet, Text } from 'react-native';
import { colors, spacing } from './theme';

export function TierBadge({ tier }: { tier: Tier }) {
  if (tier !== 'premium') return null;
  return <Text style={styles.badge}>Premium</Text>;
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    color: colors.premium,
    backgroundColor: colors.premiumBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
