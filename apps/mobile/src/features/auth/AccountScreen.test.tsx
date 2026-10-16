import { fireEvent, screen, waitFor } from '@testing-library/react-native';
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
