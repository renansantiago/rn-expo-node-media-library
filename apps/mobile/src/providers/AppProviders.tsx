import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiClientProvider, createApiClient, type ApiClient } from '../lib/api';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { createQueryClient } from '../lib/query-client';

interface Props {
  children: ReactNode;
  /** Injection points for tests. */
  apiClient?: ApiClient;
  queryClient?: QueryClient;
}

export function AppProviders({ children, apiClient, queryClient }: Props) {
  const [client] = useState(
    () =>
      apiClient ??
      createApiClient({ baseUrl: config.apiBaseUrl, timeoutMs: config.requestTimeoutMs, logger }),
  );
  const [queries] = useState(() => queryClient ?? createQueryClient());

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queries}>
        <ApiClientProvider client={client}>{children}</ApiClientProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
