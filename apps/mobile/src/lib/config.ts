import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = 3000;

interface ApiUrlInputs {
  envUrl?: string;
  /** Expo dev server address, e.g. "192.168.0.10:8081". */
  hostUri?: string | null;
  os: string;
}

/**
 * Resolution order: explicit EXPO_PUBLIC_API_URL → the dev machine's address taken from Expo's
 * hostUri (works for devices on the LAN) → emulator/simulator loopback defaults.
 */
export function resolveApiBaseUrl({ envUrl, hostUri, os }: ApiUrlInputs): string {
  if (envUrl) return envUrl.replace(/\/+$/, '');
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:${API_PORT}`;
  return os === 'android' ? `http://10.0.2.2:${API_PORT}` : `http://localhost:${API_PORT}`;
}

export const config = {
  apiBaseUrl: resolveApiBaseUrl({
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    hostUri: Constants.expoConfig?.hostUri,
    os: Platform.OS,
  }),
  requestTimeoutMs: 10_000,
} as const;
