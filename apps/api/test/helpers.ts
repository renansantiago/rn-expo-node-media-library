import { LoginResponseSchema } from '@media-library/contracts';
import { buildApp, type App } from '../src/app';
import { openDatabase, type DbHandle } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/db/seed';

export const TEST_PASSWORD = 'test-password';
export const FREE_USER = 'free-user';
export const PREMIUM_USER = 'premium-user';

export interface TestContext {
  app: App;
  handle: DbHandle;
  /** Logs a seeded user in and returns its bearer token. */
  login: (username?: string) => Promise<string>;
  close: () => Promise<void>;
}

interface TestAppOptions {
  withSeed?: boolean;
  extend?: (app: App) => void;
  now?: () => Date;
  tokenTtlHours?: number;
}

/** Fresh in-memory database (migrated, optionally seeded) behind a fully wired app. */
export async function createTestApp({
  withSeed = true,
  extend,
  now,
  tokenTtlHours = 1,
}: TestAppOptions = {}): Promise<TestContext> {
  const handle = openDatabase(':memory:');
  runMigrations(handle.db);
  if (withSeed) await seed(handle.db, { demoPassword: TEST_PASSWORD });

  const app = await buildApp({
    config: { LOG_LEVEL: 'silent', LOG_PRETTY: false, AUTH_TOKEN_TTL_HOURS: tokenTtlHours },
    db: handle.db,
    now,
  });
  extend?.(app);
  await app.ready();

  return {
    app,
    handle,
    login: async (username = FREE_USER) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { username, password: TEST_PASSWORD },
      });
      if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
      return LoginResponseSchema.parse(res.json()).token;
    },
    close: async () => {
      await app.close();
      handle.close();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
