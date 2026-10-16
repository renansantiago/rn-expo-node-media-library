import { fireEvent, screen } from '@testing-library/react-native';
import { FREE_ITEM, itemId, PREMIUM_ITEM } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { ItemDetailScreen } from './ItemDetailScreen';

function renderDetail(id: string, signedInAs?: 'free' | 'premium') {
  const onPlay = jest.fn();
  const onSignIn = jest.fn();
  const result = renderWithProviders(
    <ItemDetailScreen itemId={id} onPlay={onPlay} onSignIn={onSignIn} />,
    { signedInAs },
  );
  return { onPlay, onSignIn, result };
}

describe('ItemDetailScreen', () => {
  it('shows metadata and duration', async () => {
    const { result } = renderDetail(FREE_ITEM.id);
    await result;
    expect(await screen.findByRole('header', { name: FREE_ITEM.title })).toBeOnTheScreen();
    expect(screen.getByText('Animation · 10:35')).toBeOnTheScreen();
    expect(screen.getByText(FREE_ITEM.description)).toBeOnTheScreen();
  });

  it('asks signed-out users to sign in before playing', async () => {
    const { onSignIn, result } = renderDetail(FREE_ITEM.id);
    await result;
    await fireEvent.press(await screen.findByRole('button', { name: 'Sign in to watch' }));
    expect(onSignIn).toHaveBeenCalled();
  });

  it('lets entitled users play', async () => {
    const { onPlay, result } = renderDetail(PREMIUM_ITEM.id, 'premium');
    await result;
    await fireEvent.press(await screen.findByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledWith(PREMIUM_ITEM.id);
  });

  it('explains when the user plan does not include the item', async () => {
    const { result } = renderDetail(PREMIUM_ITEM.id, 'free');
    await result;
    expect(await screen.findByText('Included with Premium')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('shows a not-found error for unknown items', async () => {
    const { result } = renderDetail(itemId(9999));
    await result;
    expect(await screen.findByText('Not found')).toBeOnTheScreen();
  });
});
