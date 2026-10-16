import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client';
import { resolveMigrationsFolder, runMigrations } from '../src/db/migrate';
import { categories, items, users } from '../src/db/schema';
import { seed } from '../src/db/seed';

describe('database setup', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the database file (and parent folders) with WAL and foreign keys enabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'media-db-'));
    dirs.push(dir);
    const path = join(dir, 'nested', 'test.db');

    const handle = openDatabase(path);
    try {
      expect(existsSync(path)).toBe(true);
      expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      handle.close();
    }
  });

  it('applies migrations idempotently and seeds without duplicating rows', async () => {
    const handle = openDatabase(':memory:');
    try {
      runMigrations(handle.db);
      runMigrations(handle.db);
      const first = await seed(handle.db, { demoPassword: 'pw-12345678' });
      await seed(handle.db, { demoPassword: 'pw-12345678' });

      expect(handle.db.select().from(categories).all()).toHaveLength(first.categories);
      expect(handle.db.select().from(items).all()).toHaveLength(first.items);
      const seededUsers = handle.db.select().from(users).all();
      expect(seededUsers).toHaveLength(first.users);
      // Passwords are stored as salted scrypt hashes, never in plaintext.
      for (const user of seededUsers) {
        expect(user.passwordHash).toMatch(/^scrypt\$/);
        expect(user.passwordHash).not.toContain('pw-12345678');
      }
    } finally {
      handle.close();
    }
  });

  it('enforces the category foreign key', () => {
    const handle = openDatabase(':memory:');
    try {
      runMigrations(handle.db);
      expect(() =>
        handle.db
          .insert(items)
          .values({
            id: '00000000-0000-4000-8000-999999999999',
            title: 'Orphan',
            description: '',
            categoryId: 'missing',
            durationSec: 1,
            streamUrl: 'https://example.com/a.m3u8',
            createdAt: new Date(),
          })
          .run(),
      ).toThrow(/FOREIGN KEY/);
    } finally {
      handle.close();
    }
  });

  it('reports a clear error when the migrations folder cannot be found', () => {
    expect(() => resolveMigrationsFolder(tmpdir())).toThrow(/migrations folder/);
  });
});
