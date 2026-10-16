import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { loadConfig, loadDotEnv } from '../config';
import { openDatabase } from './client';
import { runMigrations } from './migrate';
import { seed } from './seed';
import { SEED_USERS } from './seed-data';

const COMMANDS = ['migrate', 'seed', 'reset'] as const;

/** Database maintenance CLI: `migrate`, `seed` or `reset` (delete file + migrate + seed). */
async function main(command: string | undefined) {
  if (!COMMANDS.includes(command as (typeof COMMANDS)[number])) {
    console.error(`Usage: cli.ts <${COMMANDS.join('|')}>`);
    process.exitCode = 1;
    return;
  }

  loadDotEnv();
  const config = loadConfig();
  const { DATABASE_PATH } = config;

  if (command === 'reset') {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${DATABASE_PATH}${suffix}`, { force: true });
  }

  const handle = openDatabase(DATABASE_PATH);
  try {
    if (command === 'migrate' || command === 'reset') {
      runMigrations(handle.db);
      console.log(`Migrations applied to ${DATABASE_PATH}`);
    }
    if (command === 'seed' || command === 'reset') {
      const generated = !config.DEMO_USER_PASSWORD;
      const demoPassword = config.DEMO_USER_PASSWORD ?? randomBytes(9).toString('base64url');
      const counts = await seed(handle.db, { demoPassword });
      console.log(
        `Seeded ${counts.categories} categories, ${counts.items} items and ${counts.users} users`,
      );
      console.log(`Demo users: ${SEED_USERS.map((u) => `${u.username} (${u.tier})`).join(', ')}`);
      if (generated) {
        console.log(
          `DEMO_USER_PASSWORD is not set; generated password for new demo users: ${demoPassword}`,
        );
      }
    }
  } finally {
    handle.close();
  }
}

main(process.argv[2]).catch((err) => {
  console.error(err);
  process.exit(1);
});
