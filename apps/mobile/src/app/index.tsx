import { Stack } from 'expo-router';
import { CatalogScreen } from '../features/catalog/CatalogScreen';

export default function CatalogRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Catalog' }} />
      <CatalogScreen />
    </>
  );
}
