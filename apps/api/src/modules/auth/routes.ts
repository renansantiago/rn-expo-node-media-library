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
    { schema: { body: LoginRequestSchema, response: { 200: LoginResponseSchema } } },
    async (request, reply) => {
      const { username, password } = request.body;
      const result = await authService.login(username, password);
      request.log.info({ userId: result.user.id }, 'login succeeded');
      reply.header('Cache-Control', 'no-store');
      return result;
    },
  );

  app.post('/auth/logout', { preHandler: app.authenticate }, async (request, reply) => {
    authService.logout(request.authToken!);
    return reply.status(204).send();
  });

  app.get(
    '/me',
    { preHandler: app.authenticate, schema: { response: { 200: MeResponseSchema } } },
    async (request) => ({ user: request.requireUser() }),
  );
};
