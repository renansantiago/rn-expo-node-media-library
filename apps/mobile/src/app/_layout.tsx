import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from '../providers/AppProviders';

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      <Stack>
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
    </AppProviders>
  );
}
