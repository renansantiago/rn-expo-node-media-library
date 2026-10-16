import { openDatabaseAsync } from 'expo-sqlite';

export type SqlValue = string | number | null;

/**
 * The subset of expo-sqlite's async API the app uses. Keeping it this small lets tests run the
 * exact same SQL against an in-memory better-sqlite3 database (see `src/test/sqlite.ts`).
 */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<{ changes: number }>;
  getFirstAsync<T>(sql: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * Ordered, append-only schema migrations. The applied version lives in `PRAGMA user_version`;
 * never edit a shipped migration, add a new one instead.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: local progress (what the player resumes from) and the sync outbox.
  `
  CREATE TABLE progress (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    position_sec REAL NOT NULL,
    duration_sec REAL NOT NULL,
    recorded_at INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id)
  );
  CREATE TABLE outbox (
    user_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    position_sec REAL NOT NULL,
    recorded_at INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    PRIMARY KEY (user_id, item_id)
  );
  CREATE TABLE meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
];

export async function migrate(db: SqlDatabase, migrations = MIGRATIONS): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const from = row?.user_version ?? 0;
  for (let version = from + 1; version <= migrations.length; version++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migrations[version - 1]!);
      await db.execAsync(`PRAGMA user_version = ${version}`);
    });
  }
  return migrations.length;
}

const DATABASE_NAME = 'media-library.db';

/** Opens the on-device database and brings its schema up to date. */
export async function openAppDatabase(): Promise<SqlDatabase> {
  const native = await openDatabaseAsync(DATABASE_NAME);
  await native.execAsync('PRAGMA journal_mode = WAL;');
  const db: SqlDatabase = {
    execAsync: (sql) => native.execAsync(sql),
    runAsync: (sql, params) => native.runAsync(sql, params),
    getFirstAsync: (sql, params) => native.getFirstAsync(sql, params),
    getAllAsync: (sql, params) => native.getAllAsync(sql, params),
    withTransactionAsync: (task) => native.withTransactionAsync(task),
  };
  await migrate(db);
  return db;
}
