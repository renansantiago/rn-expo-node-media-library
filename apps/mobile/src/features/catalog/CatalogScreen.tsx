import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import { colors } from '../../components/theme';
import { toUserFacingError } from '../../lib/user-facing-error';
import { useCatalogItems } from './api';
import { ItemRow } from './components/ItemRow';

export function CatalogScreen() {
  const { data, error, isPending, isRefetching, refetch } = useCatalogItems();

  if (isPending) return <LoadingView label="Loading catalog" />;
  if (error && !data)
    return <ErrorView error={toUserFacingError(error)} onRetry={() => void refetch()} />;

  return (
    <FlatList
      data={data?.data ?? []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ItemRow item={item} />}
      ItemSeparatorComponent={Separator}
      ListEmptyComponent={<EmptyView title="No videos yet" message="The catalog is empty." />}
      contentContainerStyle={!data?.data.length ? styles.emptyContainer : undefined}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
      style={styles.list}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: colors.background },
  emptyContainer: { flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 156 },
});
