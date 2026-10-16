import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CORRELATION_ID_HEADER, CORRELATION_ID_PATTERN } from '@media-library/contracts';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Used as Fastify's `genReqId`: reuse the app-supplied correlation ID when it is well formed,
 * otherwise mint one. Fastify then binds it to `request.id` and to every log line of the request.
 */
export function resolveCorrelationId(req: IncomingMessage): string {
  const header = req.headers[CORRELATION_ID_HEADER];
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

/** Echoes the correlation ID on every response so clients can report it. */
export const correlationIdPlugin = fp(
  async (app: FastifyInstance) => {
    app.addHook('onRequest', async (request, reply) => {
      reply.header(CORRELATION_ID_HEADER, request.id);
    });
  },
  { name: 'correlation-id' },
);
