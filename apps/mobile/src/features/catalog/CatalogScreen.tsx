import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { colors, spacing } from '../../components/theme';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useCatalogItems, useCategories } from './api';
import { CategoryFilter } from './components/CategoryFilter';
import { ItemRow } from './components/ItemRow';

interface Props {
  onOpenItem: (id: string) => void;
}

export function CatalogScreen({ onOpenItem }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const categories = useCategories();
  const catalog = useCatalogItems(category);

  const items = catalog.data?.pages.flatMap((page) => page.data) ?? [];

  const loadMore = () => {
    if (catalog.hasNextPage && !catalog.isFetchingNextPage && !catalog.isFetchNextPageError) {
      void catalog.fetchNextPage();
    }
  };

  let body;
  if (catalog.isPending) {
    body = <LoadingView label="Loading catalog" />;
  } else if (catalog.error && !catalog.data) {
    body = (
      <ErrorView error={toUserFacingError(catalog.error)} onRetry={() => void catalog.refetch()} />
    );
  } else {
    body = (
      <FlatList
        testID="catalog-list"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ItemRow item={item} onPress={onOpenItem} />}
        ItemSeparatorComponent={Separator}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          <EmptyView
            title="No videos yet"
            message={category ? 'Nothing in this category.' : 'The catalog is empty.'}
          />
        }
        ListFooterComponent={
          <ListFooter
            loading={catalog.isFetchingNextPage}
            failed={catalog.isFetchNextPageError}
            onRetry={() => void catalog.fetchNextPage()}
          />
        }
        contentContainerStyle={!items.length ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={catalog.isRefetching && !catalog.isFetchingNextPage}
            onRefresh={() => void catalog.refetch()}
          />
        }
        style={styles.list}
      />
    );
  }

  return (
    <View style={styles.screen}>
      {categories.data?.length ? (
        <CategoryFilter categories={categories.data} selected={category} onSelect={setCategory} />
      ) : null}
      {body}
    </View>
  );
}

function ListFooter({
  loading,
  failed,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <View style={styles.footer} accessibilityLabel="Loading more">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (failed) {
    return (
      <View style={styles.footer} accessibilityRole="alert">
        <Text style={styles.footerText}>Couldn&apos;t load more videos.</Text>
        <Button title="Retry" variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  return null;
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  emptyContainer: { flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 156 },
  footer: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  footerText: { color: colors.textMuted },
});
