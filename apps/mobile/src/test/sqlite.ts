import Database from 'better-sqlite3';
import { migrate, type SqlDatabase } from '../lib/db/database';

/** Real SQLite (in memory) behind the app's `SqlDatabase` interface, for tests. */
export function createTestSqlDatabase(): SqlDatabase & { close: () => void } {
  const sqlite = new Database(':memory:');
  return {
    execAsync: async (sql) => {
      sqlite.exec(sql);
    },
    runAsync: async (sql, params) => ({ changes: sqlite.prepare(sql).run(...params).changes }),
    getFirstAsync: async <T>(sql: string, params: unknown[]) =>
      (sqlite.prepare(sql).get(...params) as T | undefined) ?? null,
    getAllAsync: async <T>(sql: string, params: unknown[]) =>
      sqlite.prepare(sql).all(...params) as T[],
    withTransactionAsync: async (task) => {
      sqlite.exec('BEGIN');
      try {
        await task();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => sqlite.close(),
  };
}

export async function createMigratedTestDatabase() {
  const db = createTestSqlDatabase();
  await migrate(db);
  return db;
}
