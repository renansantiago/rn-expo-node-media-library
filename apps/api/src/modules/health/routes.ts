import { HealthResponseSchema, ReadyResponseSchema } from '@media-library/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors';
import type { Db } from '../../db/client';

export const healthRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  // Liveness: the process is up.
  app.get('/health', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    uptimeSec: Math.round(process.uptime()),
  }));

  // Readiness: dependencies are reachable.
  app.get('/ready', { schema: { response: { 200: ReadyResponseSchema } } }, async (request) => {
    try {
      db.get(sql`select 1`);
    } catch (err) {
      request.log.error({ err }, 'readiness check failed: database');
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Database unavailable');
    }
    return { status: 'ready' as const, checks: { database: 'ok' as const } };
  });
};
