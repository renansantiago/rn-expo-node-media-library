import type { Item } from '@media-library/contracts';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { TierBadge } from '../../../components/TierBadge';
import { colors, spacing } from '../../../components/theme';
import { formatDuration } from '../../../lib/format';

interface Props {
  item: Item;
  onPress: (id: string) => void;
}

function ItemRowComponent({ item, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.category.name}, ${formatDuration(item.durationSec)}`}
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`catalog-item-${item.id}`}
    >
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
        <TierBadge tier={item.requiredTier} />
      </View>
    </Pressable>
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
  pressed: { backgroundColor: colors.surface },
  thumbnail: { width: 128, height: 72, borderRadius: 6, backgroundColor: colors.surface },
  thumbnailPlaceholder: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  body: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
});
