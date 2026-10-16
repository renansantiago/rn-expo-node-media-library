import type { Item } from '@media-library/contracts';
import { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../../../components/theme';
import { formatDuration } from '../../../lib/format';

function ItemRowComponent({ item }: { item: Item }) {
  return (
    <View style={styles.row} testID={`catalog-item-${item.id}`}>
      {item.thumbnailUrl ? (
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={styles.thumbnail}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.thumbnail, styles.thumbnailPlaceholder]} />
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta}>
          {item.category.name} · {formatDuration(item.durationSec)}
        </Text>
        {item.requiredTier === 'premium' ? <Text style={styles.badge}>Premium</Text> : null}
      </View>
    </View>
  );
}

export const ItemRow = memo(ItemRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.background,
  },
  thumbnail: { width: 128, height: 72, borderRadius: 6, backgroundColor: colors.surface },
  thumbnailPlaceholder: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  body: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
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
