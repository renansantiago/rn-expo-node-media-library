import { resolveApiBaseUrl } from './config';

describe('resolveApiBaseUrl', () => {
  it('prefers the explicit env URL and strips trailing slashes', () => {
    expect(
      resolveApiBaseUrl({
        envUrl: 'https://api.example.com/',
        hostUri: '10.0.0.5:8081',
        os: 'ios',
      }),
    ).toBe('https://api.example.com');
  });

  it("uses the Expo dev server's host so physical devices reach the API", () => {
    expect(resolveApiBaseUrl({ hostUri: '192.168.1.20:8081', os: 'android' })).toBe(
      'http://192.168.1.20:3000',
    );
  });

  it('falls back to emulator/simulator loopback addresses', () => {
    expect(resolveApiBaseUrl({ hostUri: null, os: 'android' })).toBe('http://10.0.2.2:3000');
    expect(resolveApiBaseUrl({ os: 'ios' })).toBe('http://localhost:3000');
  });
});
