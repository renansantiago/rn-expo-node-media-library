import { rmSync } from 'node:fs';
import { loadConfig, loadDotEnv } from '../config';
import { openDatabase } from './client';
import { runMigrations } from './migrate';
import { seed } from './seed';

/** Database maintenance CLI: `migrate`, `seed` or `reset` (delete file + migrate + seed). */
function main(command: string | undefined) {
  loadDotEnv();
  const { DATABASE_PATH } = loadConfig();

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
      const counts = seed(handle.db);
      console.log(`Seeded ${counts.categories} categories and ${counts.items} items`);
    }
    if (!['migrate', 'seed', 'reset'].includes(command ?? '')) {
      console.error('Usage: cli.ts <migrate|seed|reset>');
      process.exitCode = 1;
    }
  } finally {
    handle.close();
  }
}

main(process.argv[2]);
