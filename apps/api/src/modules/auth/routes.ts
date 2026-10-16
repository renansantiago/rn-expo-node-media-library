import {
  LoginRequestSchema,
  LoginResponseSchema,
  MeResponseSchema,
} from '@media-library/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthService } from './service';

export const authRoutes: FastifyPluginAsyncZod<{ authService: AuthService }> = async (
  app,
  { authService },
) => {
  app.post(
    '/auth/login',
    {
      config: { rateLimit: app.rateLimits.login },
      schema: {
        tags: ['auth'],
        summary: 'Log in and receive a bearer token',
        body: LoginRequestSchema,
        response: { 200: LoginResponseSchema },
      },
    },
    async (request, reply) => {
      const { username, password } = request.body;
      const result = await authService.login(username, password);
      request.log.info({ userId: result.user.id }, 'login succeeded');
      reply.header('Cache-Control', 'no-store');
      return result;
    },
  );

  app.post(
    '/auth/logout',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current token (204)',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      authService.logout(request.authToken!);
      return reply.status(204).send();
    },
  );

  app.get(
    '/me',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'The signed-in user',
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponseSchema },
      },
    },
    async (request) => ({ user: request.requireUser() }),
  );
};
