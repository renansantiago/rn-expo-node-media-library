import type { ApiErrorBody, ErrorCode } from '@media-library/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

function send(
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
) {
  const body: ApiErrorBody = {
    error: { code, message, correlationId: request.id, ...(details ? { details } : {}) },
  };
  return reply.status(status).send(body);
}

/** Maps every failure to the shared error envelope; never leaks internals on 5xx. */
export const errorHandlerPlugin = fp(
  async (app: FastifyInstance) => {
    app.setErrorHandler((error: FastifyError, request, reply) => {
      if (error instanceof AppError) {
        return send(reply, request, error.statusCode, error.code, error.message, error.details);
      }

      if (hasZodFastifySchemaValidationErrors(error)) {
        const details = error.validation.map((issue) => ({
          path: issue.instancePath,
          message: issue.message,
        }));
        return send(reply, request, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
      }

      if (isResponseSerializationError(error)) {
        request.log.error({ err: error }, 'response failed contract validation');
        return send(reply, request, 500, 'INTERNAL_ERROR', 'Internal server error');
      }

      const status = error.statusCode ?? 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'unhandled error');
        return send(reply, request, 500, 'INTERNAL_ERROR', 'Internal server error');
      }

      // Framework-level 4xx (malformed JSON, unsupported media type, ...).
      return send(
        reply,
        request,
        status,
        CODE_BY_STATUS[status] ?? 'VALIDATION_ERROR',
        error.message,
      );
    });

    app.setNotFoundHandler((request, reply) =>
      send(reply, request, 404, 'NOT_FOUND', `Route ${request.method} ${request.url} not found`),
    );
  },
  { name: 'error-handler' },
);
