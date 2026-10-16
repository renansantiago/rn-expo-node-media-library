# ADR 0004: Rate limiting on write endpoints

- **Status:** accepted
- **Context:** Write endpoints need protection against abuse: password guessing on login and runaway clients on progress writes. Reads (the public catalog, a user's own progress) should stay unlimited.

## Decision

- **Only writes are limited**, with `@fastify/rate-limit` attached per route. Limits run as a `preHandler`, after body validation and authentication, so they can be keyed by username or user instead of IP alone. Unauthenticated writes get `401` before any counting.
- **Login: per (client IP, username).** Guessing passwords for one account slows down quickly, without locking out everyone behind a shared IP (NAT, office networks). Usernames are lower-cased so casing cannot bypass the limit.
- **Progress writes: per user**, one budget shared by `PUT /v1/me/progress/:id` and `POST /v1/me/progress/batch`. The default (120 per minute) leaves room for normal saves (one every 10 s) plus an offline catch-up burst.
- **Response:** `429` in the usual error envelope (`code: RATE_LIMITED`, `details.retryAfterSec`), with `Retry-After` and `x-ratelimit-*` headers. Rejections are logged and counted in `/metrics`.
- **Shared counter store.** The library's in-memory store keeps a separate map per route, which would let a client double its write budget by alternating the two endpoints. A small fixed-window store (`SharedMemoryStore`, bounded with LRU eviction) is shared by every route instead.
- **Client behaviour:** the sync queue reschedules exactly as long as `Retry-After` says. Reads honour short waits (up to 10 s) and otherwise show the error with Retry. Sign-in tells the user when to try again.
- Limits are configurable (`RATE_LIMIT_WINDOW_SEC`, `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_WRITE_MAX`).

## Consequences

- Counters live in one process's memory. Several API instances would use the library's Redis store, and volumetric abuse belongs at the edge (API gateway / WAF).
- A fixed window allows a burst of up to twice the limit across a window boundary. That is acceptable for these limits; a sliding window or token bucket would smooth it.
