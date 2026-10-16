import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { createdPlayers } from '../../test/fake-video-player';
import { FREE_ITEM, PREMIUM_ITEM, USERS } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { http } from 'msw';
import {
  apiError,
  fakeProgress,
  makeProgress,
  seedServerProgress,
  server,
  TEST_API_URL,
} from '../../test/server';
import { createMigratedTestDatabase } from '../../test/sqlite';
import { createProgressStore } from '../progress/store';
import { PlayerScreen } from './PlayerScreen';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function renderPlayer(
  options: Parameters<typeof renderWithProviders>[1] = { signedInAs: 'premium' },
) {
  const result = await renderWithProviders(
    <PlayerScreen itemId={PREMIUM_ITEM.id} onSignIn={jest.fn()} />,
    options,
  );
  await screen.findByTestId('video-view');
  const player = createdPlayers.at(-1)!;
  await waitFor(() => expect(player.play).toHaveBeenCalled());
  return { ...result, player };
}

describe('PlayerScreen', () => {
  it('plays when the user is entitled', async () => {
    const { player } = await renderPlayer();
    expect(player.currentTime).toBe(0);
    // The progress tracker relies on one time update per second.
    expect(player.timeUpdateEventInterval).toBe(1);
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

  describe('resume', () => {
    it('resumes from the position saved by another device', async () => {
      seedServerProgress(
        USERS.premium.id,
        makeProgress(PREMIUM_ITEM.id, 300, { recordedAt: ago(60_000) }),
      );
      const { player } = await renderPlayer();
      expect(player.currentTime).toBe(300);
    });

    it('prefers this device’s newer, not-yet-synced position over an older server one', async () => {
      const db = await createMigratedTestDatabase();
      await createProgressStore(db).record(USERS.premium.id, {
        itemId: PREMIUM_ITEM.id,
        positionSec: 400,
        durationSec: PREMIUM_ITEM.durationSec,
      });
      seedServerProgress(
        USERS.premium.id,
        makeProgress(PREMIUM_ITEM.id, 100, { recordedAt: ago(60 * 60_000) }),
      );

      const { player } = await renderPlayer({
        signedInAs: 'premium',
        database: Promise.resolve(db),
      });
      expect(player.currentTime).toBe(400);
    });

    it('starts over when the video was already watched to the end', async () => {
      seedServerProgress(
        USERS.premium.id,
        makeProgress(PREMIUM_ITEM.id, PREMIUM_ITEM.durationSec, { recordedAt: ago(1_000) }),
      );
      const { player } = await renderPlayer();
      expect(player.currentTime).toBe(0);
    });

    it('still plays (from the start) if on-device storage is unavailable', async () => {
      const { player } = await renderPlayer({
        signedInAs: 'premium',
        database: Promise.reject(new Error('disk full')),
      });
      expect(player.currentTime).toBe(0);
    });
  });

  it('explains stream failures and retries from a fresh playback grant', async () => {
    const { player } = await renderPlayer();
    await act(async () =>
      player.emit('statusChange', { status: 'error', error: { message: 'HTTP 403 from CDN' } }),
    );
    expect(await screen.findByText("Can't play this video")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  });

  it('shows an error when the item itself cannot be loaded', async () => {
    server.use(
      http.get(`${TEST_API_URL}/v1/items/:id`, () => apiError(503, 'SERVICE_UNAVAILABLE')),
    );
    await renderWithProviders(<PlayerScreen itemId={PREMIUM_ITEM.id} onSignIn={jest.fn()} />, {
      signedInAs: 'premium',
    });
    expect(await screen.findByText('Server problem')).toBeOnTheScreen();
    expect(screen.queryByTestId('video-view')).toBeNull();
  });

  it('saves progress while watching and syncs it to the server', async () => {
    const { player } = await renderPlayer();
    await act(async () => {
      for (let t = 1; t <= 42; t++) player.emit('timeUpdate', { currentTime: t });
      player.emit('playingChange', { isPlaying: false });
    });

    await waitFor(() =>
      expect(fakeProgress.get(USERS.premium.id)?.get(PREMIUM_ITEM.id)?.positionSec).toBe(42),
    );
  });
});
