import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { delay, http, HttpResponse } from 'msw';
import { CATALOG, makeItem, USERS } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import {
  apiError,
  makeProgress,
  seedServerProgress,
  server,
  TEST_API_URL,
} from '../../test/server';
import { CatalogScreen } from './CatalogScreen';

const itemsUrl = `${TEST_API_URL}/v1/items`;

const renderCatalog = (
  onOpenItem = jest.fn(),
  options?: Parameters<typeof renderWithProviders>[1],
) => renderWithProviders(<CatalogScreen onOpenItem={onOpenItem} />, options);

describe('CatalogScreen', () => {
  it('renders catalog items with category, duration and premium badge', async () => {
    server.use(
      http.get(itemsUrl, () =>
        HttpResponse.json({
          data: [
            makeItem({ title: 'Big Buck Bunny', durationSec: 635 }, 1),
            makeItem({ title: 'Orbital Drift', requiredTier: 'premium', durationSec: 3725 }, 2),
          ],
          nextCursor: null,
        }),
      ),
    );
    await renderCatalog();

    expect(await screen.findByText('Big Buck Bunny')).toBeOnTheScreen();
    expect(screen.getByText('Animation · 10:35')).toBeOnTheScreen();
    expect(screen.getByText('Animation · 1:02:05')).toBeOnTheScreen();
    expect(screen.getAllByText('Premium')).toHaveLength(1);
  });

  // FlatList virtualises rows under test, so assert on the list's data rather than off-screen rows.
  const listedIds = () =>
    (screen.getByTestId('catalog-list').props.data as { id: string }[]).map((i) => i.id);

  it('loads the next page when the end of the list is reached', async () => {
    await renderCatalog();
    await screen.findByText(CATALOG[0]!.title);
    expect(listedIds()).toEqual(CATALOG.slice(0, 20).map((i) => i.id));

    await fireEvent(screen.getByTestId('catalog-list'), 'endReached');

    await waitFor(() => expect(listedIds()).toEqual(CATALOG.map((i) => i.id)));
  });

  it('shows an inline retry when loading more fails, keeping loaded items', async () => {
    let failNext = true;
    server.use(
      http.get(itemsUrl, ({ request }) => {
        if (new URL(request.url).searchParams.get('cursor') && failNext) {
          failNext = false;
          return apiError(503, 'SERVICE_UNAVAILABLE');
        }
        return undefined;
      }),
    );
    await renderCatalog();
    await screen.findByText(CATALOG[0]!.title);

    await fireEvent(screen.getByTestId('catalog-list'), 'endReached');
    expect(await screen.findByText("Couldn't load more videos.")).toBeOnTheScreen();
    expect(screen.getByText(CATALOG[0]!.title)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listedIds()).toHaveLength(CATALOG.length));
  });

  it('filters by category', async () => {
    await renderCatalog();
    await screen.findByText(CATALOG[0]!.title);

    await fireEvent.press(await screen.findByRole('tab', { name: 'Sci-Fi' }));

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sci-Fi' })).toBeSelected());
    const sciFi = CATALOG.filter((i) => i.category.slug === 'sci-fi');
    await waitFor(() => expect(listedIds()).toEqual(sciFi.map((i) => i.id)));
    expect(screen.getByRole('tab', { name: 'All' })).not.toBeSelected();
  });

  it('opens an item when it is pressed', async () => {
    const onOpenItem = jest.fn();
    await renderCatalog(onOpenItem);
    await fireEvent.press(await screen.findByTestId(`catalog-item-${CATALOG[0]!.id}`));
    expect(onOpenItem).toHaveBeenCalledWith(CATALOG[0]!.id);
  });

  it('shows an empty state when the catalog has no items', async () => {
    server.use(http.get(itemsUrl, () => HttpResponse.json({ data: [], nextCursor: null })));
    await renderCatalog();
    expect(await screen.findByText('No videos yet')).toBeOnTheScreen();
  });

  it('shows a server error with the correlation reference, then recovers on retry', async () => {
    server.use(
      http.get(
        itemsUrl,
        () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR', message: 'boom', correlationId: 'abcdef12-3456' } },
            { status: 500 },
          ),
        { once: true },
      ),
    );
    await renderCatalog();

    expect(await screen.findByText('Server problem')).toBeOnTheScreen();
    expect(screen.getByText('Ref: abcdef12')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(CATALOG[0]!.title)).toBeOnTheScreen();
  });

  it('shows a timeout message when the API is too slow', async () => {
    server.use(
      http.get(itemsUrl, async () => {
        await delay(500);
        return HttpResponse.json({ data: [], nextCursor: null });
      }),
    );
    await renderCatalog(jest.fn(), { timeoutMs: 50 });
    expect(await screen.findByText('Taking too long')).toBeOnTheScreen();
  });

  it('shows a connectivity message when the network fails', async () => {
    server.use(http.get(itemsUrl, () => HttpResponse.error()));
    await renderCatalog();
    expect(await screen.findByText("Can't reach the server")).toBeOnTheScreen();
  });

  it('rejects responses that break the contract instead of rendering garbage', async () => {
    server.use(http.get(itemsUrl, () => HttpResponse.json({ items: 'nope' })));
    await renderCatalog();
    expect(await screen.findByText('Unexpected response')).toBeOnTheScreen();
  });

  it('shows how far the signed-in user got in each video, including on other devices', async () => {
    const [watching, finished] = [CATALOG[0]!, CATALOG[1]!];
    seedServerProgress(USERS.free.id, makeProgress(watching.id, 300));
    seedServerProgress(USERS.free.id, makeProgress(finished.id, finished.durationSec));
    await renderCatalog(jest.fn(), { signedInAs: 'free' });

    expect(await screen.findByLabelText('Watched 5:00 of 10:35')).toBeOnTheScreen();
    // A finished video shows no resume bar (it will start over).
    expect(screen.getAllByRole('progressbar', { name: /^Watched/ })).toHaveLength(1);
  });
});
