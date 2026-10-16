import type { Item } from '@media-library/contracts';
import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { ProgressBar } from '../../../components/ProgressBar';
import { TierBadge } from '../../../components/TierBadge';
import { colors, spacing } from '../../../components/theme';
import { formatDuration } from '../../../lib/format';
import { resumePositionSec } from '../../progress/resume';
import type { LocalProgress } from '../../progress/store';

interface Props {
  item: Item;
  onPress: (id: string) => void;
  progress?: LocalProgress;
}

function ItemRowComponent({ item, onPress, progress }: Props) {
  const resumeAt = resumePositionSec(progress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.category.name}, ${formatDuration(item.durationSec)}`}
      onPress={() => onPress(item.id)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`catalog-item-${item.id}`}
    >
      <View style={styles.thumbnail}>
        {item.thumbnailUrl ? (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.thumbnailPlaceholder]} />
        )}
        {resumeAt > 0 ? (
          <ProgressBar
            value={resumeAt / item.durationSec}
            label={`Watched ${formatDuration(resumeAt)} of ${formatDuration(item.durationSec)}`}
            style={styles.progress}
          />
        ) : null}
      </View>
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
  thumbnail: {
    width: 128,
    height: 72,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumbnailPlaceholder: {
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  body: { flex: 1, justifyContent: 'center', gap: spacing.xs },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
});
