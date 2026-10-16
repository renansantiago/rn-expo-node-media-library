import { buildApp, type App } from '../src/app';
import { openDatabase, type DbHandle } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { seed } from '../src/db/seed';

export interface TestContext {
  app: App;
  handle: DbHandle;
  close: () => Promise<void>;
}

/** Fresh in-memory database (migrated, optionally seeded) behind a fully wired app. */
export async function createTestApp({
  withSeed = true,
  extend,
}: { withSeed?: boolean; extend?: (app: App) => void } = {}): Promise<TestContext> {
  const handle = openDatabase(':memory:');
  runMigrations(handle.db);
  if (withSeed) seed(handle.db);

  const app = await buildApp({ config: { LOG_LEVEL: 'silent', LOG_PRETTY: false }, db: handle.db });
  extend?.(app);
  await app.ready();

  return {
    app,
    handle,
    close: async () => {
      await app.close();
      handle.close();
    },
  };
}
