import { fireEvent, screen } from '@testing-library/react-native';
import { FREE_ITEM, PREMIUM_ITEM } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { PlayerScreen } from './PlayerScreen';

describe('PlayerScreen', () => {
  it('plays when the user is entitled', async () => {
    await renderWithProviders(<PlayerScreen itemId={PREMIUM_ITEM.id} onSignIn={jest.fn()} />, {
      signedInAs: 'premium',
    });
    expect(await screen.findByTestId('video-view')).toBeOnTheScreen();
  });

  it('shows a clear message when the API denies access', async () => {
    await renderWithProviders(<PlayerScreen itemId={PREMIUM_ITEM.id} onSignIn={jest.fn()} />, {
      signedInAs: 'free',
    });
    expect(await screen.findByText('Not available')).toBeOnTheScreen();
    expect(screen.queryByTestId('video-view')).toBeNull();
  });

  it('asks signed-out users to sign in', async () => {
    const onSignIn = jest.fn();
    await renderWithProviders(<PlayerScreen itemId={FREE_ITEM.id} onSignIn={onSignIn} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalled();
  });
});
