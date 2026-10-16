import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI 3 document generated from the same zod schemas that validate requests and responses, so
 * the documentation cannot drift from the implementation. Served at `/docs` (UI) and `/docs/json`.
 * Must be registered before the routes it documents.
 */
export const openApiPlugin = fp(
  async (app: FastifyInstance) => {
    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Media Library API',
          version: '1.0.0',
          description:
            'Catalog, entitlement-checked playback and cross-device playback progress. Every error uses the envelope `{ error: { code, message, correlationId, details? } }`.',
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              description: 'Token from /v1/auth/login',
            },
          },
        },
        tags: [
          { name: 'health', description: 'Liveness, readiness and metrics' },
          { name: 'catalog', description: 'Public catalog and entitlement-checked playback' },
          { name: 'auth', description: 'Token login and session' },
          { name: 'progress', description: 'Per-user playback progress (multi-device)' },
        ],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'openapi' },
);
