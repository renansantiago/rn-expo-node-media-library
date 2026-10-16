import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { Screen } from '../../components/Screen';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { colors, spacing } from '../../components/theme';
import { useIsOnline } from '../../lib/network';
import { OFFLINE_ERROR, toUserFacingError } from '../../lib/user-facing-error';
import { useProgressMap } from '../progress/hooks';
import { useCachedItemsFor, useCatalogItems, useCategories } from './api';
import { CategoryFilter } from './components/CategoryFilter';
import { ItemRow } from './components/ItemRow';

interface Props {
  onOpenItem: (id: string) => void;
}

export function CatalogScreen({ onOpenItem }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const categories = useCategories();
  const catalog = useCatalogItems(category);
  const progress = useProgressMap();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();

  // Nothing cached for this exact list yet: fall back to matching items saved by other lists.
  const usingFallback = !catalog.data && (catalog.isPending || !!catalog.error);
  const fallback = useCachedItemsFor(category, usingFallback);
  const showingSaved = usingFallback && fallback.length > 0;
  const items = catalog.data?.pages.flatMap((page) => page.data) ?? (showingSaved ? fallback : []);

  const loadMore = () => {
    if (catalog.hasNextPage && !catalog.isFetchingNextPage && !catalog.isFetchNextPageError) {
      void catalog.fetchNextPage();
    }
  };

  let body;
  if (!showingSaved) {
    if (catalog.isPending && catalog.fetchStatus === 'paused') {
      // Offline with nothing cached yet; the query resumes by itself when connectivity returns.
      body = <ErrorView error={OFFLINE_ERROR} />;
    } else if (catalog.isPending) {
      body = <LoadingView label="Loading catalog" />;
    } else if (catalog.error && !catalog.data) {
      body = (
        <ErrorView
          error={toUserFacingError(catalog.error)}
          onRetry={() => void catalog.refetch()}
        />
      );
    }
  }
  if (!body) {
    body = (
      <FlatList
        testID="catalog-list"
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ItemRow item={item} onPress={onOpenItem} progress={progress.data?.get(item.id)} />
        )}
        extraData={progress.data}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          showingSaved ? (
            <SavedNotice
              failed={!!catalog.error}
              offline={catalog.fetchStatus === 'paused'}
              onRetry={() => void catalog.refetch()}
            />
          ) : undefined
        }
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
            offline={!online && (catalog.hasNextPage || showingSaved)}
            onRetry={() => void catalog.fetchNextPage()}
          />
        }
        contentContainerStyle={[
          { paddingBottom: insets.bottom },
          !items.length && styles.emptyContainer,
        ]}
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
    <Screen scrollable>
      {categories.data?.length ? (
        <CategoryFilter categories={categories.data} selected={category} onSelect={setCategory} />
      ) : null}
      {body}
    </Screen>
  );
}

/** Explains that the list shows saved videos only, and why. */
function SavedNotice({
  failed,
  offline,
  onRetry,
}: {
  failed: boolean;
  offline: boolean;
  onRetry: () => void;
}) {
  if (failed) {
    return (
      <View style={styles.notice} accessible accessibilityRole="alert">
        <Text style={styles.noticeText}>
          Couldn&apos;t reach the server. Showing videos saved on this device.
        </Text>
        <Button title="Retry" variant="secondary" onPress={onRetry} />
      </View>
    );
  }
  return (
    <View style={styles.notice} accessible accessibilityLabel="Showing saved videos">
      <Text style={styles.noticeText}>
        {offline ? 'Showing videos saved on this device.' : 'Showing saved videos while loading…'}
      </Text>
    </View>
  );
}

function ListFooter({
  loading,
  failed,
  offline,
  onRetry,
}: {
  loading: boolean;
  failed: boolean;
  offline: boolean;
  onRetry: () => void;
}) {
  if (offline) {
    return (
      <View style={styles.footer}>
        <Text style={styles.footerText}>You&apos;re offline. Connect to load more videos.</Text>
      </View>
    );
  }
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
  list: { flex: 1 },
  emptyContainer: { flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 156 },
  footer: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
  footerText: { color: colors.textMuted },
  notice: {
    margin: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  noticeText: { color: colors.text, fontSize: 14 },
});
