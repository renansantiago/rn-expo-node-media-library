import type { ApiErrorKind } from './api/errors';

export type RequestOutcome = 'success' | ApiErrorKind;

export interface RequestMetric {
  method: string;
  /** Path template, e.g. `/v1/items/:id` (ids are never used as labels). */
  route: string;
  /** HTTP status, or null when no response arrived (timeout, network). */
  status: number | null;
  outcome: RequestOutcome;
  durationMs: number;
}

export interface RouteSummary {
  count: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
}

export interface MetricsSnapshot {
  total: number;
  errors: number;
  /** 0..1 */
  errorRate: number;
  byRoute: Record<string, RouteSummary>;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export const normalizeRoute = (path: string) => path.replace(UUID, ':id');

const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : 0;

/**
 * In-process request metrics: count, error rate and latency per route, mirroring what the API
 * exposes at `/metrics`. This is the hook point for a real telemetry SDK (OpenTelemetry, Sentry,
 * Datadog…): forward each `RequestMetric` from `record` instead of (or as well as) aggregating.
 * A bounded window of recent latencies is kept per route, so memory stays constant.
 */
export function createRequestMetrics({ window = 200 }: { window?: number } = {}) {
  const routes = new Map<string, { count: number; errors: number; latencies: number[] }>();

  return {
    record(metric: RequestMetric) {
      const key = `${metric.method} ${metric.route}`;
      const entry = routes.get(key) ?? { count: 0, errors: 0, latencies: [] };
      entry.count += 1;
      if (metric.outcome !== 'success') entry.errors += 1;
      entry.latencies.push(metric.durationMs);
      if (entry.latencies.length > window) entry.latencies.shift();
      routes.set(key, entry);
    },

    snapshot(): MetricsSnapshot {
      let total = 0;
      let errors = 0;
      const byRoute: Record<string, RouteSummary> = {};
      for (const [key, entry] of routes) {
        total += entry.count;
        errors += entry.errors;
        const sorted = [...entry.latencies].sort((a, b) => a - b);
        byRoute[key] = {
          count: entry.count,
          errors: entry.errors,
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
        };
      }
      return { total, errors, errorRate: total ? errors / total : 0, byRoute };
    },

    reset() {
      routes.clear();
    },
  };
}

export type RequestMetrics = ReturnType<typeof createRequestMetrics>;

/** App-wide instance, fed by the API client. */
export const requestMetrics = createRequestMetrics();
