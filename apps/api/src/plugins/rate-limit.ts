import rateLimit, { type FastifyRateLimitStore, type RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';

export interface RateLimitSettings {
  windowSec: number;
  loginMax: number;
  writeMax: number;
}

type Counter = { current: number; ttl: number; startedAt: number };
type Callback = (error: Error | null, result?: { current: number; ttl: number }) => void;

/**
 * Fixed-window counters in one bounded map shared by every route. The library's default memory
 * store creates a separate map per route, which would let a client double its write budget by
 * alternating the single and batch endpoints; keys here are already namespaced per limit.
 */
export class SharedMemoryStore implements FastifyRateLimitStore {
  private readonly counters = new Map<string, Counter>();
  private readonly maxKeys = 10_000;

  incr(key: string, callback: Callback, timeWindow: number) {
    const now = Date.now();
    let counter = this.counters.get(key);
    if (!counter || counter.startedAt + timeWindow <= now) {
      counter = { current: 0, ttl: timeWindow, startedAt: now };
    }
    counter.current += 1;
    counter.ttl = timeWindow - (now - counter.startedAt);
    this.counters.delete(key); // re-insert: Map order doubles as least-recently-used order
    this.counters.set(key, counter);
    if (this.counters.size > this.maxKeys) {
      this.counters.delete(this.counters.keys().next().value!);
    }
    callback(null, { current: counter.current, ttl: counter.ttl });
  }

  read(key: string, callback: Callback, timeWindow: number) {
    const counter = this.counters.get(key);
    const now = Date.now();
    if (!counter || counter.startedAt + timeWindow <= now) callback(null, { current: 0, ttl: 0 });
    else callback(null, { current: counter.current, ttl: timeWindow - (now - counter.startedAt) });
  }

  child() {
    return this;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Per-route rate-limit configs: `config: { rateLimit: app.rateLimits.write }`. */
    rateLimits: { login: RateLimitOptions; write: RateLimitOptions };
  }
}

/**
 * Rate limiting for write endpoints only; reads stay unlimited. Limits run as a preHandler, after
 * body validation and authentication, so they can be keyed by username or user instead of IP alone.
 * Counters live in memory (one process); several API instances would share a Redis store instead.
 */
export const rateLimitPlugin = fp(
  async (app: FastifyInstance, { windowSec, loginMax, writeMax }: RateLimitSettings) => {
    await app.register(rateLimit, {
      global: false,
      // Instantiated once per registration, so one shared store per app.
      store: SharedMemoryStore,
      hook: 'preHandler',
      // Thrown, then rendered by the error handler as the usual envelope (429 + Retry-After).
      errorResponseBuilder: (_request, context) =>
        new AppError(429, 'RATE_LIMITED', `Too many requests, retry in ${context.after}`, {
          retryAfterSec: Math.ceil(context.ttl / 1000),
        }),
      onExceeded: (request) =>
        request.log.warn({ route: request.routeOptions.url }, 'rate limit exceeded'),
    });

    const timeWindow = windowSec * 1000;
    app.decorate('rateLimits', {
      // Slows password guessing for one account without locking everyone behind a shared IP (NAT).
      login: {
        max: loginMax,
        timeWindow,
        keyGenerator: (request: FastifyRequest) => {
          const username = (request.body as { username?: unknown } | undefined)?.username;
          return `login:${request.ip}:${typeof username === 'string' ? username.toLowerCase() : ''}`;
        },
      },
      // Generous enough for normal saves (one every 10s) plus an offline catch-up burst.
      write: {
        max: writeMax,
        timeWindow,
        keyGenerator: (request: FastifyRequest) =>
          request.user ? `write:user:${request.user.id}` : `write:ip:${request.ip}`,
      },
    });
  },
  { name: 'rate-limit' },
);
