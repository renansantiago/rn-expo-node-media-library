import { describe, expect, it } from 'vitest';
import { loadConfig, loadDotEnv } from '../src/config';

describe('loadConfig', () => {
  it('applies safe defaults for local development', () => {
    expect(loadConfig({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      DATABASE_PATH: './data/media-library.db',
    });
  });

  it('coerces and validates values from the environment', () => {
    const config = loadConfig({
      PORT: '8080',
      LOG_PRETTY: 'true',
      LOG_LEVEL: 'debug',
      NODE_ENV: 'production',
    });
    expect(config).toMatchObject({
      PORT: 8080,
      LOG_PRETTY: true,
      LOG_LEVEL: 'debug',
      NODE_ENV: 'production',
    });
    expect(loadConfig({ LOG_PRETTY: '0' }).LOG_PRETTY).toBe(false);
  });

  it('fails fast with a readable message listing every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', LOG_LEVEL: 'loud' })).toThrow(
      /Invalid configuration:\n {2}- PORT: .*\n {2}- LOG_LEVEL: /,
    );
  });

  it('tolerates a missing .env file', () => {
    expect(() => loadDotEnv()).not.toThrow();
  });
});
