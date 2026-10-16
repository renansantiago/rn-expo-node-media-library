import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

/**
 * Finds the committed `drizzle/` migrations folder by walking up from this file, so it works
 * from `src/` (tsx, vitest) and from the bundled `dist/` output alike.
 */
export function resolveMigrationsFolder(start = dirname(fileURLToPath(import.meta.url))): string {
  let dir = start;
  for (;;) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Could not locate the drizzle migrations folder');
    dir = parent;
  }
}

export function runMigrations(db: Db, migrationsFolder = resolveMigrationsFolder()): void {
  migrate(db, { migrationsFolder });
}
