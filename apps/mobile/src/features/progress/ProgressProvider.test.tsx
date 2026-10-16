import { act, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { FREE_ITEM, USERS } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { fakeProgress, makeProgress, seedServerProgress, server } from '../../test/server';
import { createMigratedTestDatabase } from '../../test/sqlite';
import { useProgressContext } from './ProgressProvider';
import { createProgressStore } from './store';

const captured: { current?: ReturnType<typeof useProgressContext> } = {};
function Probe() {
  const value = useProgressContext();
  useEffect(() => {
    captured.current = value;
  });
  return <Text>{value.storeStatus}</Text>;
}
const context = () => captured.current!;

function captureAppState() {
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  return (state: AppStateStatus) => act(async () => listeners.forEach((l) => l(state)));
}

describe('ProgressProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('delivers progress queued before the app was closed as soon as it starts', async () => {
    const db = await createMigratedTestDatabase();
    await createProgressStore(db).record(USERS.free.id, {
      itemId: FREE_ITEM.id,
      positionSec: 77,
      durationSec: FREE_ITEM.durationSec,
    });

    await renderWithProviders(<Probe />, { signedInAs: 'free', database: Promise.resolve(db) });
    await waitFor(() =>
      expect(fakeProgress.get(USERS.free.id)?.get(FREE_ITEM.id)?.positionSec).toBe(77),
    );
    expect(await createProgressStore(db).pendingCount(USERS.free.id)).toBe(0);
  });

  it('catches up with other devices when the app returns to the foreground', async () => {
    const setAppState = captureAppState();
    const { database } = await renderWithProviders(<Probe />, { signedInAs: 'free' });
    await screen.findByText('ready');

    seedServerProgress(USERS.free.id, makeProgress(FREE_ITEM.id, 222));
    await setAppState('active');

    const store = createProgressStore(await database);
    await waitFor(async () =>
      expect((await store.get(USERS.free.id, FREE_ITEM.id))?.positionSec).toBe(222),
    );
  });

  it('records locally and syncs through record()', async () => {
    await renderWithProviders(<Probe />, { signedInAs: 'free' });
    await screen.findByText('ready');
    await act(() =>
      context().record({
        itemId: FREE_ITEM.id,
        positionSec: 12,
        durationSec: FREE_ITEM.durationSec,
        reason: 'pause',
      }),
    );
    await waitFor(() =>
      expect(fakeProgress.get(USERS.free.id)?.get(FREE_ITEM.id)?.positionSec).toBe(12),
    );
  });

  it('stays quiet while signed out: no sync, and record() is a no-op', async () => {
    const requests: string[] = [];
    const onRequest = ({ request }: { request: Request }) => requests.push(request.url);
    server.events.on('request:start', onRequest);
    const { database } = await renderWithProviders(<Probe />);
    await screen.findByText('ready');

    await act(() =>
      context().record({
        itemId: FREE_ITEM.id,
        positionSec: 12,
        durationSec: 600,
        reason: 'pause',
      }),
    );
    server.events.removeListener('request:start', onRequest);

    expect(context().sync).toBeNull();
    expect(requests.filter((url) => url.includes('/progress'))).toEqual([]);
    expect(await createProgressStore(await database).list(USERS.free.id)).toEqual([]);
  });

  it('reports storage failures without breaking the app', async () => {
    await renderWithProviders(<Probe />, {
      signedInAs: 'free',
      database: Promise.reject(new Error('disk full')),
    });
    expect(await screen.findByText('failed')).toBeOnTheScreen();
    await act(() =>
      context().record({ itemId: FREE_ITEM.id, positionSec: 1, durationSec: 600, reason: 'exit' }),
    );
  });
});
