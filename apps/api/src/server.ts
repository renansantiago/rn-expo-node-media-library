import { buildApp } from './app';
import { loadConfig, loadDotEnv } from './config';
import { openDatabase } from './db/client';
import { runMigrations } from './db/migrate';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const handle = openDatabase(config.DATABASE_PATH);
  // Schema is always brought up to date on boot; seeding stays an explicit step (`db:seed`).
  runMigrations(handle.db);

  const app = await buildApp({ config, db: handle.db });
  app.addHook('onClose', async () => handle.close());

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    try {
      await app.close();
      clearTimeout(timer);
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
