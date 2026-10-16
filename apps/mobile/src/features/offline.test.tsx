import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager } from '@tanstack/react-query';
import type { Item } from '@media-library/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
import { OfflineBanner } from '../components/OfflineBanner';
import { createQueryPersister, PERSIST_STORAGE_KEY } from '../lib/query-persistence';
import { CATALOG, FREE_ITEM, USERS } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { fakeProgress, receivedBatches, server, TEST_API_URL } from '../test/server';
import { CatalogScreen } from './catalog/CatalogScreen';
import { ItemDetailScreen } from './item/ItemDetailScreen';
import { PlayerScreen } from './player/PlayerScreen';
import { useProgressContext } from './progress/ProgressProvider';
import { createProgressStore } from './progress/store';

const goOffline = () => act(async () => onlineManager.setOnline(false));
const goOnline = () => act(async () => onlineManager.setOnline(true));
const PERSIST_TIMEOUT = { timeout: 4_000 };

const storedCache = async () => {
  const raw = await AsyncStorage.getItem(PERSIST_STORAGE_KEY);
  return raw
    ? (JSON.parse(raw) as { buster: string; clientState: { queries: { queryKey: unknown[] }[] } })
    : null;
};

/** First session: browse online until the catalog has been written to disk. */
async function browseOnlineOnce() {
  const persister = createQueryPersister(AsyncStorage);
  const first = await renderWithProviders(<CatalogScreen onOpenItem={jest.fn()} />, {
    persister,
    signedInAs: 'premium',
  });
  expect(await screen.findByText(CATALOG[0]!.title)).toBeOnTheScreen();
  await waitFor(async () => {
    const keys = (await storedCache())?.clientState.queries.map((q) => q.queryKey[1]);
    expect(keys).toContain('items');
  }, PERSIST_TIMEOUT);
  await first.unmount();
  return persister;
}

describe('offline behaviour', () => {
  afterEach(() => AsyncStorage.clear());

  describe('catalog', () => {
    it('explains a cold start without network, then loads by itself when it returns', async () => {
      await goOffline();
      await renderWithProviders(<CatalogScreen onOpenItem={jest.fn()} />);
      expect(await screen.findByText("You're offline")).toBeOnTheScreen();

      await goOnline();
      expect(await screen.findByText(CATALOG[0]!.title)).toBeOnTheScreen();
    });

    it('reopens with the catalog saved by a previous session, without network', async () => {
      const persister = await browseOnlineOnce();

      await goOffline();
      await renderWithProviders(<CatalogScreen onOpenItem={jest.fn()} />, { persister });
      expect(await screen.findByText(CATALOG[0]!.title)).toBeOnTheScreen();
      expect(screen.getByText("You're offline. Connect to load more videos.")).toBeOnTheScreen();
    });

    it('shows saved videos for a category that was never opened', async () => {
      const persister = await browseOnlineOnce(); // only "All" was loaded

      await goOffline();
      await renderWithProviders(<CatalogScreen onOpenItem={jest.fn()} />, { persister });
      await fireEvent.press(await screen.findByRole('tab', { name: 'Animation' }));

      expect(await screen.findByText('Showing videos saved on this device.')).toBeOnTheScreen();
      const shown = screen.getByTestId('catalog-list').props.data as Item[];
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.every((item) => item.category.slug === 'animation')).toBe(true);
    });

    it('never writes user-scoped data (stream URLs, progress) to disk', async () => {
      const persister = createQueryPersister(AsyncStorage);
      await renderWithProviders(<PlayerScreen itemId={FREE_ITEM.id} onSignIn={jest.fn()} />, {
        persister,
        signedInAs: 'premium',
      });
      await screen.findByTestId('video-view');
      await waitFor(async () => expect(await storedCache()).not.toBeNull(), PERSIST_TIMEOUT);

      const cache = (await storedCache())!;
      expect(cache.clientState.queries.every((q) => q.queryKey[0] === 'catalog')).toBe(true);
      expect(JSON.stringify(cache)).not.toContain('cdn.test');
    });

    it('discards a cache written by another app version', async () => {
      await browseOnlineOnce();
      const cache = (await storedCache())!;
      await AsyncStorage.setItem(
        PERSIST_STORAGE_KEY,
        JSON.stringify({ ...cache, buster: 'stale' }),
      );

      await goOffline();
      await renderWithProviders(<CatalogScreen onOpenItem={jest.fn()} />, {
        persister: createQueryPersister(AsyncStorage),
      });
      expect(await screen.findByText("You're offline")).toBeOnTheScreen();
    });

    it('survives a corrupted cache and loads from the network', async () => {
      await AsyncStorage.setItem(PERSIST_STORAGE_KEY, '{not json');
      await renderWithProviders(<CatalogScreen onOpenItem={jest.fn()} />, {
        persister: createQueryPersister(AsyncStorage),
      });
      expect(await screen.findByText(CATALOG[0]!.title)).toBeOnTheScreen();
      // …and replaces the unreadable entry with a fresh, valid cache.
      await waitFor(
        async () => expect((await storedCache())?.buster).not.toBe('unreadable'),
        PERSIST_TIMEOUT,
      );
    });
  });

  describe('item detail', () => {
    it('shows details cached from the catalog while offline', async () => {
      const persister = await browseOnlineOnce();
      await goOffline();
      await renderWithProviders(
        <ItemDetailScreen itemId={CATALOG[0]!.id} onPlay={jest.fn()} onSignIn={jest.fn()} />,
        { persister, signedInAs: 'premium' },
      );
      expect(await screen.findByRole('header', { name: CATALOG[0]!.title })).toBeOnTheScreen();
    });

    it('explains when an item was never loaded', async () => {
      await goOffline();
      await renderWithProviders(
        <ItemDetailScreen itemId={FREE_ITEM.id} onPlay={jest.fn()} onSignIn={jest.fn()} />,
      );
      expect(await screen.findByText("You're offline")).toBeOnTheScreen();
    });
  });

  it('player: explains that playback needs a connection instead of spinning', async () => {
    await goOffline();
    await renderWithProviders(<PlayerScreen itemId={FREE_ITEM.id} onSignIn={jest.fn()} />, {
      signedInAs: 'free',
    });
    expect(await screen.findByText(/Playback needs an internet connection/)).toBeOnTheScreen();
    expect(screen.queryByTestId('video-view')).toBeNull();

    await goOnline();
    expect(await screen.findByTestId('video-view')).toBeOnTheScreen();
  });

  it('banner: shows only while offline', async () => {
    await renderWithProviders(<OfflineBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
    await goOffline();
    expect(screen.getByRole('alert')).toHaveTextContent(/You're offline/);
    await goOnline();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('progress', () => {
    const captured: { current?: ReturnType<typeof useProgressContext> } = {};
    function Probe() {
      captured.current = useProgressContext();
      return null;
    }
    const save = (positionSec: number) =>
      act(() =>
        captured.current!.record({
          itemId: FREE_ITEM.id,
          positionSec,
          durationSec: FREE_ITEM.durationSec,
          reason: 'pause',
        }),
      );
    const serverPosition = () => fakeProgress.get(USERS.free.id)?.get(FREE_ITEM.id)?.positionSec;

    it('is kept on the device while offline and delivered as soon as the network returns', async () => {
      const { database } = await renderWithProviders(<Probe />, { signedInAs: 'free' });
      await waitFor(() => expect(captured.current?.sync).not.toBeNull());

      await goOffline();
      await save(150);
      expect(receivedBatches).toHaveLength(0);
      expect(await createProgressStore(await database).pendingCount(USERS.free.id)).toBe(1);

      await goOnline();
      await waitFor(() => expect(serverPosition()).toBe(150));
    });

    it('skips a pending retry backoff when the network returns', async () => {
      server.use(http.post(`${TEST_API_URL}/v1/me/progress/batch`, () => HttpResponse.error()));
      await renderWithProviders(<Probe />, { signedInAs: 'free' });
      await waitFor(() => expect(captured.current?.sync).not.toBeNull());

      await save(60); // fails → rescheduled with backoff (seconds away)
      await waitFor(async () =>
        expect(await captured.current!.store!.nextAttemptAt(USERS.free.id)).toBeGreaterThan(
          Date.now(),
        ),
      );
      server.resetHandlers();

      await goOffline();
      await goOnline();
      await waitFor(() => expect(serverPosition()).toBe(60));
    });
  });
});
