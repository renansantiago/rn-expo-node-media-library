import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { http, HttpResponse } from 'msw';
import { TEST_PASSWORD } from '../../test/fixtures';
import { renderWithProviders } from '../../test/render';
import { server, TEST_API_URL } from '../../test/server';
import { SESSION_STORAGE_KEY } from './session';
import { LoginScreen } from './LoginScreen';

async function fillAndSubmit(username: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Username'), username);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginScreen', () => {
  it('keeps the submit button disabled until both fields are filled', async () => {
    await renderWithProviders(<LoginScreen onSuccess={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Username'), 'free-user');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  it('signs in, persists the session securely and reports success', async () => {
    const onSuccess = jest.fn();
    const { storage } = await renderWithProviders(<LoginScreen onSuccess={onSuccess} />);
    await fillAndSubmit('  premium-user ', TEST_PASSWORD);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    await waitFor(async () => {
      const stored = JSON.parse((await storage.get(SESSION_STORAGE_KEY)) ?? '{}');
      expect(stored.user?.username).toBe('premium-user');
    });
  });

  it('shows a clear message for wrong credentials', async () => {
    const onSuccess = jest.fn();
    await renderWithProviders(<LoginScreen onSuccess={onSuccess} />);
    await fillAndSubmit('free-user', 'wrong');
    expect(await screen.findByText('Invalid username or password.')).toBeOnTheScreen();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('toggles password visibility with the eye button', async () => {
    await renderWithProviders(<LoginScreen onSuccess={jest.fn()} />);
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);

    await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', false);

    await fireEvent.press(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
  });

  it('explains connectivity problems with a support reference', async () => {
    server.use(http.post(`${TEST_API_URL}/v1/auth/login`, () => HttpResponse.error()));
    await renderWithProviders(<LoginScreen onSuccess={jest.fn()} />);
    await fillAndSubmit('free-user', TEST_PASSWORD);
    expect(
      await screen.findByText(/You may be offline or the server is unavailable\. \(Ref: \w{8}\)/),
    ).toBeOnTheScreen();
  });
});
