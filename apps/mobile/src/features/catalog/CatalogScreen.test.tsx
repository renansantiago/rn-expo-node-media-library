import { fireEvent, screen } from '@testing-library/react-native';
import { delay, http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/render';
import { server, TEST_API_URL } from '../../test/server';
import { makeItem } from '../../test/fixtures';
import { CatalogScreen } from './CatalogScreen';

const itemsUrl = `${TEST_API_URL}/v1/items`;

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
    await renderWithProviders(<CatalogScreen />);

    expect(await screen.findByText('Big Buck Bunny')).toBeOnTheScreen();
    expect(screen.getByText('Animation · 10:35')).toBeOnTheScreen();
    expect(screen.getByText('Animation · 1:02:05')).toBeOnTheScreen();
    expect(screen.getAllByText('Premium')).toHaveLength(1);
  });

  it('shows an empty state when the catalog has no items', async () => {
    server.use(http.get(itemsUrl, () => HttpResponse.json({ data: [], nextCursor: null })));
    await renderWithProviders(<CatalogScreen />);
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
    await renderWithProviders(<CatalogScreen />);

    expect(await screen.findByText('Server problem')).toBeOnTheScreen();
    expect(screen.getByText('Ref: abcdef12')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Item 1')).toBeOnTheScreen();
  });

  it('shows a timeout message when the API is too slow', async () => {
    server.use(
      http.get(itemsUrl, async () => {
        await delay(500);
        return HttpResponse.json({ data: [], nextCursor: null });
      }),
    );
    await renderWithProviders(<CatalogScreen />, { timeoutMs: 50 });
    expect(await screen.findByText('Taking too long')).toBeOnTheScreen();
  });

  it('shows a connectivity message when the network fails', async () => {
    server.use(http.get(itemsUrl, () => HttpResponse.error()));
    await renderWithProviders(<CatalogScreen />);
    expect(await screen.findByText("Can't reach the server")).toBeOnTheScreen();
  });

  it('rejects responses that break the contract instead of rendering garbage', async () => {
    server.use(http.get(itemsUrl, () => HttpResponse.json({ items: 'nope' })));
    await renderWithProviders(<CatalogScreen />);
    expect(await screen.findByText('Unexpected response')).toBeOnTheScreen();
  });
});
