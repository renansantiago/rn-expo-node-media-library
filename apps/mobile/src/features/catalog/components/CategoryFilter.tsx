import type { Category } from '@media-library/contracts';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../../components/theme';

interface Props {
  categories: Category[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}

export function CategoryFilter({ categories, selected, onSelect }: Props) {
  const options = [{ slug: null, name: 'All' }, ...categories];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
      style={styles.scroll}
      accessibilityRole="tablist"
    >
      {options.map(({ slug, name }) => {
        const active = slug === selected;
        return (
          <Pressable
            key={slug ?? 'all'}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={name}
            onPress={() => onSelect(slug)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  container: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontSize: 14, color: colors.text },
  chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
});
