import type { User } from '@media-library/contracts';
import { and, eq, gt, lte } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { authTokens, users, type UserRow } from '../../db/schema';

export const toUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  displayName: row.displayName,
  tier: row.tier,
});

export function createAuthRepository(db: Db) {
  return {
    findUserByUsername(username: string): UserRow | undefined {
      return db.select().from(users).where(eq(users.username, username)).get();
    },

    createToken(params: { tokenHash: string; userId: string; createdAt: Date; expiresAt: Date }) {
      db.insert(authTokens).values(params).run();
    },

    /** Resolves a token hash to its user, ignoring expired tokens. */
    findUserByTokenHash(tokenHash: string, now: Date): User | undefined {
      const row = db
        .select({ user: users })
        .from(authTokens)
        .innerJoin(users, eq(authTokens.userId, users.id))
        .where(and(eq(authTokens.tokenHash, tokenHash), gt(authTokens.expiresAt, now)))
        .get();
      return row ? toUser(row.user) : undefined;
    },

    deleteToken(tokenHash: string) {
      db.delete(authTokens).where(eq(authTokens.tokenHash, tokenHash)).run();
    },

    deleteExpiredTokens(now: Date): number {
      return db.delete(authTokens).where(lte(authTokens.expiresAt, now)).run().changes;
    },
  };
}

export type AuthRepository = ReturnType<typeof createAuthRepository>;
