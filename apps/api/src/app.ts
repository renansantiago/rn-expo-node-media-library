import Fastify, { LogController, type FastifyServerOptions } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Db } from './db/client';
import { createAuthRepository } from './modules/auth/repository';
import { authRoutes } from './modules/auth/routes';
import { createAuthService } from './modules/auth/service';
import { catalogRoutes } from './modules/catalog/routes';
import { createCatalogRepository } from './modules/catalog/repository';
import { healthRoutes } from './modules/health/routes';
import { createProgressRepository } from './modules/progress/repository';
import { progressRoutes } from './modules/progress/routes';
import { createProgressService } from './modules/progress/service';
import { authPlugin } from './plugins/auth';
import { correlationIdPlugin, resolveCorrelationId } from './plugins/correlation-id';
import { errorHandlerPlugin } from './plugins/error-handler';
import { createMetrics, metricsPlugin, type AppMetrics } from './plugins/metrics';

export interface AppDeps {
  config: Pick<Config, 'LOG_LEVEL' | 'LOG_PRETTY' | 'AUTH_TOKEN_TTL_HOURS'>;
  db: Db;
  /** Injectable clock (tests use it to exercise token expiry and the clock-skew guard). */
  now?: () => Date;
  /** Defaults to a fresh registry with process metrics. */
  metrics?: AppMetrics;
}

function loggerOptions(config: AppDeps['config']): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
    redact: ['req.headers.authorization'],
    ...(config.LOG_PRETTY ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

/** Builds the Fastify app without listening, so tests can drive it with `app.inject()`. */
export async function buildApp({ config, db, now, metrics = createMetrics() }: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config),
    genReqId: resolveCorrelationId,
    logController: new LogController({ requestIdLogLabel: 'correlationId' }),
    // Fail fast on slow clients instead of holding sockets open.
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    bodyLimit: 64 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(correlationIdPlugin);
  await app.register(errorHandlerPlugin);
  await app.register(metricsPlugin, { metrics });

  const authService = createAuthService({
    repository: createAuthRepository(db),
    tokenTtlMs: config.AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    now,
  });
  await app.register(authPlugin, { authService });

  await app.register(healthRoutes, { db });
  await app.register(authRoutes, { prefix: '/v1', authService });
  const catalogRepository = createCatalogRepository(db);
  await app.register(catalogRoutes, { prefix: '/v1', repository: catalogRepository });
  await app.register(progressRoutes, {
    prefix: '/v1',
    progressService: createProgressService({
      repository: createProgressRepository(db),
      catalog: catalogRepository,
      now,
    }),
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
