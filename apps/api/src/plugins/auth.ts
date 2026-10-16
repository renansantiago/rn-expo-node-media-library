import type { User } from '@media-library/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';
import type { AuthService } from '../modules/auth/service';

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler that rejects the request with 401 unless it carries a valid bearer token. */
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    user: User | null;
    authToken: string | null;
    /** The authenticated user; only call after `authenticate` ran. */
    requireUser(): User;
  }
}

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,256})$/;

export function extractBearerToken(header: string | undefined): string | null {
  return header?.match(BEARER)?.[1] ?? null;
}

export const authPlugin = fp(
  async (app: FastifyInstance, { authService }: { authService: AuthService }) => {
    app.decorateRequest('user', null);
    app.decorateRequest('authToken', null);
    app.decorateRequest('requireUser', function (this: FastifyRequest) {
      if (!this.user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      return this.user;
    });

    app.decorate('authenticate', async (request: FastifyRequest) => {
      const token = extractBearerToken(request.headers.authorization);
      const user = token ? authService.authenticate(token) : undefined;
      if (!token || !user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Missing, invalid or expired token');
      }
      request.user = user;
      request.authToken = token;
      request.log = request.log.child({ userId: user.id });
    });
  },
  { name: 'auth' },
);
