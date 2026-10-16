import { createTestSqlDatabase } from '../../test/sqlite';
import { migrate, MIGRATIONS, openAppDatabase } from './database';

// The native module is unavailable under Jest; back it with real (in-memory) SQLite.
const mockNative = createTestSqlDatabase();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => mockNative),
}));

const version = async (db: ReturnType<typeof createTestSqlDatabase>) =>
  (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []))?.user_version;

describe('migrate', () => {
  it('creates the schema and records the version', async () => {
    const db = createTestSqlDatabase();
    await expect(migrate(db)).resolves.toBe(MIGRATIONS.length);
    expect(await version(db)).toBe(MIGRATIONS.length);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      [],
    );
    expect(tables.map((t) => t.name)).toEqual(['meta', 'outbox', 'progress']);
  });

  it('is idempotent and only applies migrations newer than the stored version', async () => {
    const db = createTestSqlDatabase();
    await migrate(db, ['CREATE TABLE a (x INTEGER)']);
    await db.runAsync('INSERT INTO a (x) VALUES (?)', [1]);

    await migrate(db, ['CREATE TABLE a (x INTEGER)', 'ALTER TABLE a ADD COLUMN y TEXT']);
    await migrate(db, ['CREATE TABLE a (x INTEGER)', 'ALTER TABLE a ADD COLUMN y TEXT']);

    expect(await version(db)).toBe(2);
    expect(await db.getAllAsync('SELECT * FROM a', [])).toEqual([{ x: 1, y: null }]);
  });

  it('rolls back a failing migration and leaves the version untouched', async () => {
    const db = createTestSqlDatabase();
    await migrate(db, ['CREATE TABLE a (x INTEGER)']);
    await expect(
      migrate(db, ['CREATE TABLE a (x INTEGER)', 'CREATE TABLE b (y); SELECT * FROM missing']),
    ).rejects.toThrow();
    expect(await version(db)).toBe(1);
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE name = 'b'",
      [],
    );
    expect(tables).toEqual([]);
  });
});

describe('openAppDatabase', () => {
  it('opens the on-device database and migrates it to the latest schema', async () => {
    const { openDatabaseAsync } = jest.requireMock('expo-sqlite');
    const db = await openAppDatabase();
    expect(openDatabaseAsync).toHaveBeenCalledWith('media-library.db');

    await db.runAsync("INSERT INTO meta (key, value) VALUES ('k', ?)", ['v']);
    await db.withTransactionAsync(async () => {
      await db.execAsync("UPDATE meta SET value = 'w'");
    });
    expect(await db.getAllAsync('SELECT * FROM meta', [])).toEqual([{ key: 'k', value: 'w' }]);
    expect(await version(mockNative)).toBe(MIGRATIONS.length);
  });
});
