import { act, screen, waitFor } from '@testing-library/react-native';
import { http } from 'msw';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { FREE_ITEM, USERS } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { apiError, server, TEST_API_URL } from '../../test/server';
import { usePlaybackAccess } from '../player/api';
import { useAuth } from './AuthProvider';
import { SESSION_STORAGE_KEY } from './session';

const latest: { auth?: ReturnType<typeof useAuth> } = {};
function Probe() {
  const auth = useAuth();
  useEffect(() => {
    latest.auth = auth;
  });
  return <Text testID="status">{`${auth.status}:${auth.user?.username ?? '-'}`}</Text>;
}

function PlaybackProbe() {
  const access = usePlaybackAccess(FREE_ITEM.id);
  return <Text>{access.isError ? 'playback-error' : 'playback-ok'}</Text>;
}

describe('AuthProvider', () => {
  it('starts signed out when nothing is persisted', async () => {
    await renderWithProviders(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut:-'));
  });

  it('restores a persisted session and refreshes the profile', async () => {
    server.use(
      http.get(`${TEST_API_URL}/v1/me`, () =>
        Response.json({ user: { ...USERS.free, displayName: 'Renamed' } }),
      ),
    );
    await renderWithProviders(<Probe />, { signedInAs: 'free' });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signedIn:free-user'),
    );
    await waitFor(() => expect(latest.auth?.user?.displayName).toBe('Renamed'));
  });

  it('keeps the cached session when the profile refresh fails offline', async () => {
    server.use(http.get(`${TEST_API_URL}/v1/me`, () => Response.error()));
    await renderWithProviders(<Probe />, { signedInAs: 'premium' });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signedIn:premium-user'),
    );
  });

  it('drops the session (memory and storage) when the API rejects the token', async () => {
    server.use(http.get(`${TEST_API_URL}/v1/me`, () => apiError(401, 'UNAUTHORIZED')));
    const { storage } = await renderWithProviders(
      <>
        <Probe />
        <PlaybackProbe />
      </>,
      { signedInAs: 'free' },
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('signedOut:-'));
    await waitFor(async () => expect(await storage.get(SESSION_STORAGE_KEY)).toBeNull());
  });

  it('logs out locally even when the server is unreachable', async () => {
    const { storage } = await renderWithProviders(<Probe />, { signedInAs: 'free' });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signedIn:free-user'),
    );

    server.use(http.post(`${TEST_API_URL}/v1/auth/logout`, () => Response.error()));
    await act(() => latest.auth!.logout());

    expect(screen.getByTestId('status')).toHaveTextContent('signedOut:-');
    await waitFor(async () => expect(await storage.get(SESSION_STORAGE_KEY)).toBeNull());
  });
});
