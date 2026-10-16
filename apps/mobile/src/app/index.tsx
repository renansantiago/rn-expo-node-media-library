import { Stack, useRouter } from 'expo-router';
import { AccountButton } from '../features/auth/AccountButton';
import { CatalogScreen } from '../features/catalog/CatalogScreen';

export default function CatalogRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <AccountButton
              onSignIn={() => router.push('/login')}
              onOpenAccount={() => router.push('/account')}
            />
          ),
        }}
      />
      <CatalogScreen
        onOpenItem={(id) => router.push({ pathname: '/items/[id]', params: { id } })}
      />
    </>
  );
}
