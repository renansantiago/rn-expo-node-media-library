import type { LoginResponse } from '@media-library/contracts';
import { AppError } from '../../lib/errors';
import { getDummyHash, verifyPassword } from '../../lib/passwords';
import { generateToken, hashToken } from '../../lib/tokens';
import { toUser, type AuthRepository } from './repository';

export interface AuthServiceOptions {
  repository: AuthRepository;
  tokenTtlMs: number;
  now?: () => Date;
}

export function createAuthService({
  repository,
  tokenTtlMs,
  now = () => new Date(),
}: AuthServiceOptions) {
  return {
    async login(username: string, password: string): Promise<LoginResponse> {
      const user = repository.findUserByUsername(username);
      // Always run a hash comparison so response time does not reveal whether the user exists.
      const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
      if (!user || !valid) throw new AppError(401, 'UNAUTHORIZED', 'Invalid username or password');

      const issuedAt = now();
      repository.deleteExpiredTokens(issuedAt);

      const token = generateToken();
      const expiresAt = new Date(issuedAt.getTime() + tokenTtlMs);
      repository.createToken({
        tokenHash: hashToken(token),
        userId: user.id,
        createdAt: issuedAt,
        expiresAt,
      });

      return { token, expiresAt: expiresAt.toISOString(), user: toUser(user) };
    },

    authenticate(token: string) {
      return repository.findUserByTokenHash(hashToken(token), now());
    },

    logout(token: string) {
      repository.deleteToken(hashToken(token));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
