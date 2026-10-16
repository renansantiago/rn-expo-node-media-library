import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/** Latency buckets (seconds) sized for an API whose requests should take milliseconds. */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const METRICS_PATH = '/metrics';

export function createMetrics({ defaultMetrics = true }: { defaultMetrics?: boolean } = {}) {
  // One registry per app instance: tests build many apps in one process.
  const registry = new Registry();
  if (defaultMetrics) collectDefaultMetrics({ register: registry });
  const labelNames = ['method', 'route', 'status_code'] as const;
  return {
    registry,
    httpRequests: new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests handled, by method, route template and status code.',
      labelNames,
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency in seconds, by method, route template and status code.',
      labelNames,
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
    progressEvents: new Counter({
      name: 'progress_events_total',
      help: 'Progress events processed, by outcome (applied, stale, duplicate, rejected).',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
  };
}

export type AppMetrics = ReturnType<typeof createMetrics>;

declare module 'fastify' {
  interface FastifyInstance {
    metrics: AppMetrics;
  }
}

/**
 * Request count, latency and (via the status label) error rate for every route, exposed in the
 * Prometheus text format at `GET /metrics`. Routes are labelled by template (`/v1/items/:id`),
 * never by raw URL, so label cardinality stays bounded.
 */
export const metricsPlugin = fp(
  async (app: FastifyInstance, { metrics }: { metrics: AppMetrics }) => {
    app.decorate('metrics', metrics);

    app.addHook('onResponse', async (request, reply) => {
      const route = request.routeOptions.url ?? 'unmatched';
      if (route === METRICS_PATH) return;
      const labels = {
        method: request.method,
        route,
        status_code: String(reply.statusCode),
      };
      metrics.httpRequests.inc(labels);
      metrics.httpDuration.observe(labels, reply.elapsedTime / 1000);
    });

    app.get(
      METRICS_PATH,
      {
        logLevel: 'warn',
        schema: { tags: ['health'], summary: 'Prometheus metrics (text exposition format)' },
      },
      async (_request, reply) => {
        reply.header('Content-Type', metrics.registry.contentType);
        reply.header('Cache-Control', 'no-store');
        return metrics.registry.metrics();
      },
    );
  },
  { name: 'metrics' },
);
