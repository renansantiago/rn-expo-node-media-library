import { fireEvent, screen } from '@testing-library/react-native';
import { FREE_ITEM, itemId, PREMIUM_ITEM, USERS } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { makeProgress, seedServerProgress } from '../../test/server';
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

  it('offers to resume where the user left off on any device', async () => {
    seedServerProgress(USERS.free.id, makeProgress(FREE_ITEM.id, 300));
    const { onPlay, result } = renderDetail(FREE_ITEM.id, 'free');
    await result;

    await fireEvent.press(await screen.findByRole('button', { name: 'Resume from 5:00' }));
    expect(onPlay).toHaveBeenCalledWith(FREE_ITEM.id);
    expect(screen.getByText('5:35 left')).toBeOnTheScreen();
    expect(screen.getByLabelText('Watched 5:00 of 10:35')).toBeOnTheScreen();
  });

  it('offers a plain Play once the video was watched to the end', async () => {
    seedServerProgress(USERS.free.id, makeProgress(FREE_ITEM.id, FREE_ITEM.durationSec));
    const { result } = renderDetail(FREE_ITEM.id, 'free');
    await result;
    expect(await screen.findByRole('button', { name: 'Play' })).toBeOnTheScreen();
    expect(screen.queryByText(/left$/)).toBeNull();
  });
});
