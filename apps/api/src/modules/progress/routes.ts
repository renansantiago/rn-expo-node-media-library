import {
  ItemParamsSchema,
  ListProgressQuerySchema,
  ProgressBatchRequestSchema,
  ProgressBatchResponseSchema,
  ProgressEventFieldsSchema,
  ProgressListResponseSchema,
  ProgressWriteResponseSchema,
  type ProgressBatchResult,
  type ProgressRejectReason,
} from '@media-library/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors';
import type { ProgressService } from './service';

const rejectionError = (reason: ProgressRejectReason): AppError => {
  switch (reason) {
    case 'unknown_item':
      return new AppError(404, 'NOT_FOUND', 'Item not found');
    case 'forbidden':
      return new AppError(403, 'FORBIDDEN', 'Your plan does not include this item');
    case 'clock_skew':
      return new AppError(
        422,
        'CLOCK_SKEW',
        'recordedAt is too far in the future; check the device clock',
      );
  }
};

/** Per-user playback progress. Every route requires a bearer token. */
export const progressRoutes: FastifyPluginAsyncZod<{ progressService: ProgressService }> = async (
  app,
  { progressService },
) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.get(
    '/me/progress',
    {
      schema: {
        querystring: ListProgressQuerySchema,
        response: { 200: ProgressListResponseSchema },
      },
    },
    async (request) => ({
      data: progressService.list(request.requireUser().id, request.query),
    }),
  );

  // Single event. Safe to retry: the same eventId is applied at most once.
  app.put(
    '/me/progress/:id',
    {
      schema: {
        params: ItemParamsSchema,
        body: ProgressEventFieldsSchema,
        response: { 200: ProgressWriteResponseSchema },
      },
    },
    async (request) => {
      const result = progressService.record(request.requireUser(), request.params.id, request.body);
      app.metrics.progressEvents.inc({ outcome: result.ok ? result.status : 'rejected' });
      if (!result.ok) {
        request.log.info({ itemId: request.params.id, reason: result.reason }, 'progress rejected');
        throw rejectionError(result.reason);
      }
      request.log.debug({ itemId: request.params.id, status: result.status }, 'progress recorded');
      return { status: result.status, progress: result.progress };
    },
  );

  // Offline sync: many events at once, each resolved independently.
  app.post(
    '/me/progress/batch',
    {
      schema: {
        body: ProgressBatchRequestSchema,
        response: { 200: ProgressBatchResponseSchema },
      },
    },
    async (request) => {
      const outcomes = progressService.recordBatch(request.requireUser(), request.body.events);
      const results = outcomes.map(({ eventId, result }): ProgressBatchResult =>
        result.ok
          ? { eventId, status: result.status, progress: result.progress }
          : { eventId, status: 'rejected', reason: result.reason },
      );
      for (const { status } of results) app.metrics.progressEvents.inc({ outcome: status });
      const counts = Object.fromEntries(
        ['applied', 'stale', 'duplicate', 'rejected'].map((s) => [
          s,
          results.filter((r) => r.status === s).length,
        ]),
      );
      request.log.info({ events: results.length, ...counts }, 'progress batch recorded');
      return { results };
    },
  );
};
