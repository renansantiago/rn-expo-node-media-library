import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { OfflineBanner } from '../components/OfflineBanner';
import { connectNetworkToQueries } from '../lib/network';
import { AppProviders } from '../providers/AppProviders';

// Pause queries while offline and refetch when connectivity returns.
connectNetworkToQueries();

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      {/* iOS 26 defaults to a translucent Liquid Glass header that content scrolls under; keep it
          opaque so every screen lays out below it. */}
      <Stack screenOptions={{ headerTransparent: false }}>
        <Stack.Screen name="index" options={{ title: 'Catalog' }} />
        <Stack.Screen name="items/[id]" options={{ title: '' }} />
        <Stack.Screen
          name="player/[id]"
          options={{
            title: '',
            headerStyle: { backgroundColor: '#000000' },
            headerTintColor: '#FFFFFF',
          }}
        />
        <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
        <Stack.Screen name="account" options={{ title: 'Account', presentation: 'modal' }} />
      </Stack>
      <OfflineBanner />
    </AppProviders>
  );
}
