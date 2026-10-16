import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { createApiClient } from '../lib/api';
import { createLogger } from '../lib/logger';
import { AppProviders } from '../providers/AppProviders';
import { TEST_API_URL } from './server';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

/** Renders inside the real providers, with a real API client pointed at the MSW server. */
export function renderWithProviders(ui: ReactElement, { timeoutMs = 1_000 } = {}) {
  const apiClient = createApiClient({
    baseUrl: TEST_API_URL,
    timeoutMs,
    logger: createLogger({ minLevel: 'silent' }),
  });
  return render(
    <AppProviders apiClient={apiClient} queryClient={createTestQueryClient()}>
      {ui}
    </AppProviders>,
  );
}
