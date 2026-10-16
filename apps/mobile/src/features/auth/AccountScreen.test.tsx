import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createRequestMetrics } from '../../lib/telemetry';
import { renderWithProviders } from '../../test/render';
import { AccountButton } from './AccountButton';
import { AccountScreen } from './AccountScreen';
import { SESSION_STORAGE_KEY } from './session';

describe('AccountScreen', () => {
  it('shows the user and plan, and signs out', async () => {
    const onSignedOut = jest.fn();
    const { storage } = await renderWithProviders(<AccountScreen onSignedOut={onSignedOut} />, {
      signedInAs: 'premium',
    });

    expect(await screen.findByText('Premium Demo')).toBeOnTheScreen();
    expect(screen.getByText('Plan: Premium')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalled());
    expect(await storage.get(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('shows diagnostics: connectivity, request metrics and the sync backlog', async () => {
    const metrics = createRequestMetrics();
    const record = (route: string, outcome: 'success' | 'timeout', durationMs: number) =>
      metrics.record({ method: 'GET', route, status: null, outcome, durationMs });
    record('/v1/items', 'success', 40);
    record('/v1/items', 'success', 60);
    record('/v1/me', 'timeout', 10_000);

    await renderWithProviders(<AccountScreen onSignedOut={jest.fn()} metrics={metrics} />, {
      signedInAs: 'free',
    });
    expect(await screen.findByText('Diagnostics')).toBeOnTheScreen();
    expect(screen.getByText('Online')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();
    expect(screen.getByText('33.3%')).toBeOnTheScreen();
    expect(screen.getByText('10000 ms · GET /v1/me')).toBeOnTheScreen();
  });

  it('handles being opened while signed out', async () => {
    await renderWithProviders(<AccountScreen onSignedOut={jest.fn()} />);
    expect(await screen.findByText('Not signed in')).toBeOnTheScreen();
  });
});

describe('AccountButton', () => {
  it('offers sign in when signed out', async () => {
    const onSignIn = jest.fn();
    await renderWithProviders(<AccountButton onSignIn={onSignIn} onOpenAccount={jest.fn()} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('opens the account when signed in', async () => {
    const onOpenAccount = jest.fn();
    await renderWithProviders(
      <AccountButton onSignIn={jest.fn()} onOpenAccount={onOpenAccount} />,
      {
        signedInAs: 'free',
      },
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Account: Free Demo' }));
    expect(onOpenAccount).toHaveBeenCalled();
  });
});
