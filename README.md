# Media Library

A small media library product with two parts. The **mobile app** (Expo / React Native, iOS and Android) browses a catalog of videos, plays them, resumes where you left off on any device, and keeps working offline. The **API** (Node.js / Fastify / SQLite) serves the catalog, enforces who can watch what, and stores playback progress.

The focus is correctness, reliability and operational quality, not visual design.

**What it does**

- **Catalog:** cursor-paginated catalog with a category filter and item details, readable without an account.
- **Accounts and entitlements:** token login; the API releases stream URLs only to users whose plan covers the item.
- **Playback with resume:** progress is saved while you watch, survives backgrounding, crashes and offline periods, and syncs with idempotent, retry-safe writes.
- **Multi-device:** a documented rule decides which position wins when several devices report progress.
- **Offline:** the catalog, details and your progress stay available without a network; progress syncs as soon as the connection returns.
- **Operational quality:** timeouts and clear errors everywhere, structured logs on both sides, Prometheus metrics, and a correlation ID created in the app and carried through every request.
- **Security:** input validation on every route, auth on every write, rate limiting on login and writes, and no secrets in the code.

---

## Repository layout

```
apps/
  api/                 Fastify API (TypeScript, SQLite + Drizzle)
    src/
      app.ts           buildApp() factory, shared by the server and the tests
      server.ts        process entry: config, migrations, listen, graceful shutdown
      config.ts        environment parsed and validated with zod (fail fast)
      plugins/         correlation-id, error-handler, auth, metrics, rate-limit, openapi
      lib/             errors, password hashing, token helpers
      modules/         feature modules (health, catalog, auth, progress): routes + service + repository
      db/              schema, client, migrator, seed, maintenance CLI
    drizzle/           generated SQL migrations (committed)
    openapi.json       generated OpenAPI document (snapshot-tested)
    test/              integration, property-based and contract tests (in-memory SQLite)
  mobile/              Expo app (TypeScript, Expo Router)
    src/
      app/             routes (screens) only
      features/        feature code (catalog, item, player, auth, progress, diagnostics): data hooks + screens
      lib/             api client, logger, telemetry, network status, query persistence, on-device database, storage, config
      providers/       app-wide providers (query client, api client, auth session, progress)
      components/      shared UI primitives
      contract/        cross-check of the app's real client and sync engine against the real API
      test/            MSW fake API (contract-checked), fixtures, render helpers, in-memory SQLite, fake video player
packages/
  contracts/           zod schemas + TS types shared by the app and the API
docs/
  adr/                 architecture decision records
  cache-policy.md      what the app caches, for how long, and how it behaves offline
```

## Prerequisites

- **Node.js 22.12+** (an `.nvmrc` is provided, so `nvm use` works) and npm 10+.
- To run the app, one of:
  - **Expo Go** on a physical device on the same Wi-Fi network as your computer, or
  - an **iOS Simulator** (Xcode) or **Android Emulator** (Android Studio).

Nothing else: the database is a local SQLite file and no Docker is needed. Every native module the app uses ships with Expo Go, so no custom build is required.

## Quick start

From the repository root:

```bash
npm install                                    # installs every workspace
cp apps/api/.env.example apps/api/.env         # optional: local config incl. the demo password
npm run db:reset                               # creates the SQLite DB, applies migrations, seeds demo data
npm run dev:api                                # API on http://localhost:3000 (auto-reloads)
```

In a second terminal:

```bash
npm run dev:mobile   # starts Expo; press i (iOS), a (Android) or scan the QR code with Expo Go
```

The app finds the API automatically. It uses port 3000 on the machine running the Expo dev server, which works for simulators, emulators and devices on the same LAN. To point it somewhere else, copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL`.

### Demo accounts

The seed creates one user per plan, so entitlements can be tried end to end:

| Username       | Plan    | Can watch       |
| -------------- | ------- | --------------- |
| `free-user`    | Free    | Free items only |
| `premium-user` | Premium | Every item      |

Their password comes from `DEMO_USER_PASSWORD`. It is `demo-password` if you copied `apps/api/.env.example`. If the variable is unset, `npm run db:reset` generates a random password and prints it. No credentials live in the source code. Browsing the catalog needs no account; playing a video does.

### Try it

- **Interactive API docs:** open <http://localhost:3000/docs> (OpenAPI generated from the shared schemas; the raw document is at `/docs/json`).
- **Multi-device:** sign in as the same user on two simulators (or a simulator and a device). Watch a video on one, leave the player, then open the same video on the other: it offers to resume where the first device stopped.
- **Offline:** browse a little, then turn on airplane mode (or stop the API). The catalog, details and your positions stay available; progress saved meanwhile syncs when the connection returns.
- **Diagnostics:** **Account → Diagnostics** in the app shows connectivity, request count, error rate, the slowest route, progress waiting to sync, and the session ID.
- **By hand:**

```bash
curl localhost:3000/health
curl -i -H 'X-Correlation-Id: demo-12345678' 'localhost:3000/v1/items?limit=2&category=sci-fi'
TOKEN=$(curl -s -X POST localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"username":"free-user","password":"demo-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/v1/items/00000000-0000-4000-8000-000000000003/playback  # 403: premium item
ITEM=00000000-0000-4000-8000-000000000001
curl -s -X PUT localhost:3000/v1/me/progress/$ITEM -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"eventId\":\"$(node -pe 'crypto.randomUUID()')\",\"positionSec\":120,\"recordedAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"deviceId\":\"curl-device\"}"
curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/v1/me/progress   # recently watched
curl -s localhost:3000/metrics | grep http_requests_total
```

## Scripts (repository root)

| Script               | What it does                                      |
| -------------------- | ------------------------------------------------- |
| `npm run dev:api`    | Run the API in watch mode                         |
| `npm run dev:mobile` | Start the Expo dev server                         |
| `npm run db:reset`   | Delete the local DB, re-apply migrations, re-seed |
| `npm test`           | Run all test suites (API + mobile)                |
| `npm run typecheck`  | Type-check every workspace                        |
| `npm run lint`       | ESLint across the monorepo                        |
| `npm run format`     | Prettier (write); `format:check` only checks      |
| `npm run verify`     | lint + typecheck + test (what CI runs)            |

API-only scripts (`npm run <script> -w @media-library/api`): `build`, `start`, `test:coverage`, `db:generate` (new migration from schema changes), `db:migrate`, `db:seed`.

## Configuration

The API reads its configuration from the environment. Every value has a safe local default, and `.env` is optional; copy `apps/api/.env.example` to create one. No secrets are committed. `.env` files are git-ignored, and only `.env.example` files are tracked.

| Variable                | Default                   | Notes                                                        |
| ----------------------- | ------------------------- | ------------------------------------------------------------ |
| `PORT` / `HOST`         | `3000` / `0.0.0.0`        | Listens on all interfaces so devices on the LAN can reach it |
| `LOG_LEVEL`             | `info`                    | pino level (`silent` in tests)                               |
| `LOG_PRETTY`            | `false`                   | Human-readable logs for local development                    |
| `DATABASE_PATH`         | `./data/media-library.db` | SQLite file (git-ignored)                                    |
| `AUTH_TOKEN_TTL_HOURS`  | `168` (7 days)            | Lifetime of issued bearer tokens                             |
| `DEMO_USER_PASSWORD`    | unset (generated)         | Password given to seeded demo users (min. 8 chars)           |
| `RATE_LIMIT_WINDOW_SEC` | `60`                      | Window shared by the limits below                            |
| `RATE_LIMIT_LOGIN_MAX`  | `10`                      | Login attempts per window, per (client IP, username)         |
| `RATE_LIMIT_WRITE_MAX`  | `120`                     | Progress writes per window, per user                         |

## Architecture and decisions

```
┌──────────── Mobile app (Expo) ────────────┐          ┌──────────────── API (Fastify) ────────────────┐
│ Screen → TanStack Query hook              │ HTTP(S)  │ genReqId: reuse/mint correlation ID           │
│        → ApiClient                        │ ───────▶ │ zod validation (contracts)                    │
│           • X-Correlation-Id per request  │          │ auth → rate limit → route → repository →      │
│           • hard timeout (AbortController)│ ◀─────── │   SQLite (Drizzle)                            │
│           • typed errors, Retry-After     │  JSON    │ response serialised against contract schema   │
│           • response validated (zod)      │          │ error handler → { error: {code, message,      │
│ On-device SQLite: progress + sync outbox  │          │                  correlationId} }             │
│ Persisted catalog cache, NetInfo          │          │ pino JSON logs · Prometheus /metrics          │
└───────────────────────────────────────────┘          └───────────────────────────────────────────────┘
                     ▲                 packages/contracts (zod)                 ▲
                     └──────────────── single source of truth ─────────────────┘
```

Each decision below has its rationale; the bigger ones have an architecture decision record in [docs/adr](docs/adr).

- **One repository, shared contracts** ([ADR 0001](docs/adr/0001-monorepo-and-stack.md)). An npm-workspaces monorepo holds the app, the API and `packages/contracts`. Request and response shapes are zod schemas there: the API validates input and serialises output with them, the app validates every response at runtime, and the OpenAPI document is generated from them. A breaking change fails typecheck in both apps; at runtime the app shows "Unexpected response" instead of rendering bad data.
- **Correlation IDs end to end.** The app mints an ID per request and sends it as `X-Correlation-Id`. The API reuses it if it is well formed (and mints one otherwise), binds it to every log line for that request, echoes it in the response header and includes it in every error body. Error screens show a short `Ref:` so a user report can be traced to server logs.
- **Safe failure.**
  - The API returns one error envelope for every failure and never leaks internals on 5xx. It sets connection and request timeouts and a body size limit.
  - The app applies a 10 s timeout to every request, covering headers and body. Errors are typed (`TimeoutError`, `NetworkError`, `HttpError`, `InvalidResponseError`) and mapped to clear messages with a retry action.
  - Only transient errors are retried (timeouts, network failures, 5xx, 408 and 429), with capped, jittered exponential backoff. A server's `Retry-After` replaces the backoff; reads give up and show Retry when it asks for more than 10 s, while the sync queue always waits it out.
- **Authentication and entitlements** ([ADR 0002](docs/adr/0002-auth-and-entitlements.md)).
  - Logging in issues an opaque, random 256-bit bearer token. The API stores only its SHA-256 hash, with an expiry, so tokens are revocable and a database leak exposes no usable token.
  - Passwords are salted scrypt hashes. Login compares in constant time and returns the same generic 401 for an unknown user or a wrong password.
  - Reading the catalog is public. Every write, and access to a stream, requires a token.
  - The stream URL is never part of the catalog. It is only returned by `/v1/items/:id/playback`, after checking that the user's tier covers the item (`canWatch` lives in the shared contracts), with `Cache-Control: no-store`.
  - The app keeps the session in the keychain/keystore (`expo-secure-store`). A 401 on the current token signs the user out and clears every user-scoped cache entry; a failed profile refresh while offline keeps the session.
- **Rate limiting on writes.** Login is limited per (client IP, username): password guessing on one account slows down without locking out everyone behind a shared IP. Progress writes are limited per user, with one budget shared by the single and batch endpoints. Limits run after validation and authentication, reads are never limited, and over-limit requests get `429` with `Retry-After` in the usual error envelope. The app's sync queue waits exactly as long as the server asks, and sign-in tells the user when to try again. Counters are in memory, which fits one API process; several instances would share a Redis store.
- **Playback progress and the multi-device rule** ([ADR 0003](docs/adr/0003-progress-and-multi-device.md)).
  - **Rule:** the most recent _observation_ wins, by the device clock time it was recorded at, not by arrival time. Exact ties go to the greater device id, then the greater event id, which makes it a total order: every replica converges whatever the delivery order. A phone that syncs an hour-old offline session cannot overwrite what a tablet watched since, and a rewind wins when it is newer.
  - **Atomic and idempotent:** the API applies the rule in one SQL upsert. Each event carries a client UUID, so retries and replays are acknowledged as `duplicate` without being applied twice. Every write returns the canonical state so devices reconcile immediately.
  - **Guards:** events stamped more than 5 minutes ahead of the server clock are rejected (`422 CLOCK_SKEW`). Positions are clamped to the item's duration, and the item must be in the user's plan.
  - **Local first:** the app writes every save to on-device SQLite (`expo-sqlite`) and an outbox in one transaction, then syncs through the batch endpoint. The outbox keeps one pending event per item, retries with capped, jittered backoff and only forgets an event once the server has resolved it.
  - **When it saves:** every 10 s while playing, on pause, after a seek, at the end, when the app is backgrounded (the OS may kill it next) and when the player closes. It flushes after each save, on launch and sign-in, on return to foreground, and as soon as connectivity returns.
  - **Resume:** the player briefly pulls the server's latest position (3 s cap), merges it under the same rule and resumes from the winner; offline it uses local state. It starts over below 5 s or once 95% has been watched.
- **Offline first** ([docs/cache-policy.md](docs/cache-policy.md)).
  - The catalog (lists, categories, item details) is persisted to AsyncStorage with TanStack Query's persister, so the app opens offline with what it last loaded. Only public catalog data is written to disk (an allow-list), never stream URLs or anything user-scoped. The cache is versioned (schema + app version), bounded (first pages of each list), expires after 7 days and is discarded if unreadable.
  - A list that was never loaded (a new category) falls back to matching videos saved by other lists, and the detail screen keeps saved details when a refresh fails, both with a notice and Retry.
  - Thumbnails use expo-image's disk cache.
  - NetInfo drives TanStack Query's online manager: offline, requests pause instead of failing and resume on reconnect. A banner says the app is offline, and screens explain what needs a connection (loading more, playback).
- **Keyset pagination.** The catalog is ordered by `(created_at DESC, id DESC)` and paginated with an opaque cursor. Unlike `OFFSET`, pages stay stable while items are inserted, and each page costs O(limit) thanks to composite indexes. Malformed cursors return 400.
- **Liveness vs readiness.** `/health` reports that the process is up; `/ready` checks the database and returns 503 when it is unavailable.

### Trade-offs

| Choice                                     | Why                                                                                 | Cost, and what production would do                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| SQLite (better-sqlite3 + Drizzle)          | Zero setup for reviewers, real SQL and migrations, fast in-memory test databases    | One writer, one node. Postgres keeps the same schema and upserts (`ON CONFLICT … DO UPDATE … WHERE`) |
| Opaque, hashed bearer tokens               | Revocable immediately, nothing to sign or rotate, simple to reason about            | A database lookup per request. Refresh tokens and an OIDC provider at scale                          |
| Last observation wins, by device clock     | Matches what the user did last, works offline, and converges deterministically      | Trusts device clocks: bounded by the 5-minute skew guard; a slow clock loses until corrected         |
| Local-first progress with an outbox        | Progress survives crashes, backgrounding and offline periods; writes are retry-safe | More moving parts on the device than "just call the API", all covered by tests against real SQLite   |
| Expo Go compatible (no custom native code) | Anyone can run the app in minutes, no native toolchain                              | Rules out a TV build and native E2E tooling in this repo; both are documented next steps             |
| In-memory rate-limit counters              | No extra infrastructure for a single API process                                    | Not shared across instances: use the Redis store of `@fastify/rate-limit`                            |
| Static stream URLs                         | The sample streams are public test assets                                           | Short-lived signed CDN URLs from the playback endpoint                                               |

## API

Interactive documentation is served at `/docs` (OpenAPI 3.1, generated from the same zod schemas that validate requests and responses). The generated document is committed as `apps/api/openapi.json` and snapshot-tested, so every API change shows up in code review.

| Method | Path                     | Auth   | Description                                                                                                                                          |
| ------ | ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | –      | Liveness                                                                                                                                             |
| GET    | `/ready`                 | –      | Readiness (database check)                                                                                                                           |
| GET    | `/metrics`               | –      | Prometheus metrics (see [Observability](#observability))                                                                                             |
| GET    | `/v1/categories`         | –      | All categories, alphabetical                                                                                                                         |
| GET    | `/v1/items`              | –      | Catalog, newest first. `limit` 1–50 (default 20), `cursor` (from `nextCursor`), `category` (slug). Returns `{ data, nextCursor }`                    |
| GET    | `/v1/items/:id`          | –      | Item metadata and duration                                                                                                                           |
| GET    | `/v1/items/:id/playback` | Bearer | Stream URL, only if the user's tier covers the item (401 without a valid token, 403 if not entitled)                                                 |
| POST   | `/v1/auth/login`         | –      | `{ username, password }` → `{ token, expiresAt, user }`. Rate limited per (IP, username)                                                             |
| POST   | `/v1/auth/logout`        | Bearer | Revokes the token (204)                                                                                                                              |
| GET    | `/v1/me`                 | Bearer | Current user                                                                                                                                         |
| GET    | `/v1/me/progress`        | Bearer | Progress for `itemIds` (comma-separated, max 100), or the most recently watched items (`limit` 1–100, default 20)                                    |
| PUT    | `/v1/me/progress/:id`    | Bearer | One event `{ eventId, positionSec, recordedAt, deviceId }` → `{ status: applied/stale/duplicate, progress }`. 404/403/422 on rejection; rate limited |
| POST   | `/v1/me/progress/batch`  | Bearer | 1–100 events (each with `itemId`) → per-event `{ eventId, status, progress \| reason }`, in request order; rate limited                              |

Errors always look like this (`429` responses also carry `Retry-After` and `x-ratelimit-*` headers):

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "correlationId": "…",
    "details": []
  }
}
```

## Data model

| Table               | Columns                                                                                                                                                   | Notes                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `categories`        | `id` PK, `slug` unique, `name`                                                                                                                            |                                                                                                                                                              |
| `items`             | `id` PK (uuid), `title`, `description`, `category_id` FK, `duration_sec`, `thumbnail_url`, `stream_url`, `required_tier` (`free`/`premium`), `created_at` | Indexed on `(created_at, id)` and `(category_id, created_at, id)` for keyset pagination and the category filter                                              |
| `users`             | `id` PK, `username` unique, `display_name`, `tier` (`free`/`premium`), `password_hash` (`scrypt$salt$hash`), `created_at`                                 |                                                                                                                                                              |
| `auth_tokens`       | `token_hash` PK (SHA-256 of the bearer token), `user_id` FK (cascade), `created_at`, `expires_at`                                                         | Expired tokens are rejected and purged on login; indexed on `user_id` and `expires_at`                                                                       |
| `playback_progress` | PK (`user_id`, `item_id`), `position_sec`, `client_recorded_at`, `device_id`, `last_event_id`, `updated_at`                                               | Canonical position. Only replaced by a newer observation (`client_recorded_at`, then `device_id`, then event id). Indexed on `(user_id, client_recorded_at)` |
| `progress_events`   | PK (`user_id`, `event_id`), `item_id`, `position_sec`, `client_recorded_at`, `device_id`, `received_at`, `outcome` (`applied`/`stale`)                    | Idempotency ledger and audit trail of every distinct event                                                                                                   |

On the device, the app keeps its own SQLite database (`expo-sqlite`), migrated with `PRAGMA user_version` (see `apps/mobile/src/lib/db/database.ts`):

| Table      | Columns                                                                                                                        | Notes                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `progress` | PK (`user_id`, `item_id`), `position_sec`, `duration_sec`, `recorded_at`, `device_id`                                          | What the player resumes from; server state is merged in under the same rule |
| `outbox`   | PK (`user_id`, `item_id`), `event_id`, `position_sec`, `recorded_at`, `device_id`, `attempts`, `next_attempt_at`, `last_error` | One pending event per item; removed only once the server resolves it        |
| `meta`     | `key` PK, `value`                                                                                                              | The per-install `device_id`                                                 |

API migrations live in `apps/api/drizzle/`. They are generated from `src/db/schema.ts` with `npm run db:generate -w @media-library/api` and applied automatically on server start (or with `db:migrate`). The seed uses publicly hosted sample HLS/MP4 streams, and several items share a stream on purpose. Item IDs are stable across resets.

## Observability

**Logs.** Both sides write structured JSON, one object per line.

- API: pino, with the request's `correlationId` on every line (and `userId` once authenticated). Authorization headers are redacted. Each request logs `incoming request` and `request completed` with status and `responseTime`; domain events (login, playback denied, progress batch outcomes, rate limit exceeded) are logged with context.
- App: `{ ts, level, event, sessionId, … }`. Every HTTP request logs `http.response` or `http.error` with method, path, status, duration, error kind and correlation ID. Sync, cache and player events are logged too (`progress.flush_deferred`, `progress.reconnected`, `cache.unreadable`, `player.error`…).
- The correlation ID is created in the app per request, sent as `X-Correlation-Id`, reused by the API for its logs, echoed in the response header and in error bodies, and shown to the user as `Ref: abcd1234` on error screens. Grepping that reference in API logs finds the request.

**Metrics.** `GET /metrics` serves the Prometheus text format:

| Metric                          | Type      | Labels                                       | Use                                                        |
| ------------------------------- | --------- | -------------------------------------------- | ---------------------------------------------------------- |
| `http_requests_total`           | counter   | `method`, `route`, `status_code`             | Request count; error rate (and 429s) from the status label |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code`             | Latency percentiles                                        |
| `progress_events_total`         | counter   | `outcome` (applied/stale/duplicate/rejected) | Sync health: a spike in `stale` or `rejected` is a signal  |
| `process_*`, `nodejs_*`         | various   |                                              | CPU, memory, event loop lag, GC                            |

Routes are labelled by template (`/v1/items/:id`), never by raw URL, so cardinality stays bounded; unknown paths are labelled `unmatched`. Example scrape config and queries:

```yaml
scrape_configs:
  - job_name: media-library-api
    metrics_path: /metrics
    static_configs:
      - targets: ['localhost:3000']
```

```promql
sum(rate(http_requests_total[5m]))                                                        # throughput
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))  # error rate
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m]))) # p95 per route
```

In production `/metrics` would be reachable only from the internal network (or behind a token), not through the public load balancer.

**App metrics.** The API client reports every request (method, route template, status, outcome, duration) to `lib/telemetry.ts`, which aggregates count, error rate and p50/p95 latency per route. That is the hook point for a real telemetry SDK (OpenTelemetry, Sentry, Datadog): forward each record instead of only aggregating. The numbers are visible in **Account → Diagnostics**.

## Failure modes

| Failure                              | What the user sees                                                                                                                                                                                                             | What the system does                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device offline                       | Offline banner; cached catalog and details; "playback needs a connection"                                                                                                                                                      | Queries pause and resume on reconnect. Progress is saved locally and queued; the queue is flushed on reconnect, skipping backoff.                                         |
| API down / unreachable               | Cached lists keep working. A list never loaded (e.g. a new category) shows matching saved videos with a "Couldn't reach the server" notice and Retry; with nothing saved, a full-screen "Can't reach the server" with a `Ref:` | GETs retry with capped, jittered backoff (transient errors only). Progress stays in the outbox and retries with backoff (2 s → 5 min) plus on foreground and reconnect.   |
| Slow API / timeout                   | "Taking too long" with a retry                                                                                                                                                                                                 | Every request has a 10 s hard timeout (headers and body). The resume lookup waits at most 3 s, then uses local progress. The API has its own request/connection timeouts. |
| 5xx / unexpected error               | "Server problem" with a `Ref:`                                                                                                                                                                                                 | API logs the error with the correlation ID and returns a generic envelope (no internals).                                                                                 |
| Rate limited (429)                   | Sign-in: "Too many sign-in attempts. Try again in N seconds." Elsewhere: "Slow down" with the wait                                                                                                                             | `Retry-After` is honoured: the sync queue reschedules exactly that long instead of backing off on its own. Rejections are logged and counted in metrics.                  |
| Response does not match the contract | "Unexpected response"                                                                                                                                                                                                          | The app validates every response with the shared schemas and refuses to render bad data; the error is logged with the correlation ID.                                     |
| Token expired or revoked             | Signed out; asked to sign in again when needed                                                                                                                                                                                 | A 401 on a request carrying the current token clears the session and user-scoped caches. Queued progress stays on the device under that user until they sign in again.    |
| Retried / duplicated writes          | Nothing                                                                                                                                                                                                                        | Idempotent by event id: a replay is acknowledged as `duplicate` and not applied again.                                                                                    |
| Writes arriving out of order         | The newest position wins on every device                                                                                                                                                                                       | Multi-device rule in a single atomic upsert; late, older events are acknowledged as `stale`.                                                                              |
| Device clock wrong                   | Ahead: its events are rejected (and dropped). Behind: its saves lose to other devices                                                                                                                                          | Events more than 5 min ahead of the server clock get `422 CLOCK_SKEW` / `rejected`. Local timestamps never go backwards per item, so a device never loses to itself.      |
| Item removed or plan downgraded      | Item no longer playable                                                                                                                                                                                                        | Queued progress for it is rejected by the server (`unknown_item` / `forbidden`) and removed, so it never blocks the rest of the queue.                                    |
| SQLite busy / locked (API)           | Rare slow request                                                                                                                                                                                                              | WAL mode and a 5 s busy timeout. Writes are short transactions. `/ready` reports the database as unavailable if it cannot be queried.                                     |
| On-device storage unavailable        | App works; no resume and no offline progress                                                                                                                                                                                   | The progress store reports `failed`; playback starts from the beginning instead of blocking. Logged as `progress.db_open_failed`.                                         |
| Persisted cache corrupted            | Nothing (cold start from the network)                                                                                                                                                                                          | Unreadable cache is logged (`cache.unreadable`) and discarded; a fresh one is written.                                                                                    |
| App update changes cached data shape | Nothing                                                                                                                                                                                                                        | The cache buster (schema version + app version) discards the old cache on launch.                                                                                         |
| Outbox grows (long offline period)   | Nothing                                                                                                                                                                                                                        | It is bounded by design: one pending event per (user, item), coalesced on every save. Delivery is batched (100 per request, up to 10 batches per flush).                  |
| Video stream fails                   | "Can't play this video" with a retry                                                                                                                                                                                           | Retry requests a fresh playback grant. Logged as `player.error`.                                                                                                          |

## Testing

```bash
npm test                                           # everything
npm run test:coverage -w @media-library/api        # API with coverage thresholds
npm run test:coverage -w @media-library/mobile     # app with coverage thresholds
```

The suites are built in layers: unit tests for the rules, integration tests that run the real code against real SQLite, contract tests that keep the two sides honest with each other, and one cross-check that runs them together. CI enforces at least 90% line, statement and function coverage and 85% branch coverage on both sides.

- **API (Vitest).** Integration tests drive the real app through `app.inject()`, each against a fresh, migrated in-memory SQLite database:
  - health and readiness (including DB failure), the error envelope, correlation-ID propagation, and not leaking internals;
  - pagination: walking every page exactly once, timestamp ties, inserts between pages, malformed cursors, the category filter;
  - auth: login, generic errors, body validation, token hashing, expiry and purge, logout revocation; entitlements for free and premium users;
  - progress: first write, replayed event ids (single and whole batch), older events arriving late, rewinds, the tie-break in both arrival orders, clock-skew rejection and tolerance, clamping, 30 concurrent writes converging on the newest, per-user idempotency, the audit trail, mixed batch outcomes, batch size limits, listing and filtering;
  - rate limiting: per-username login limits with `Retry-After` and headers, no lockout of other accounts behind the same IP, case-insensitive usernames, window reset, one write budget per user across both endpoints, reads never limited, auth before counting, 429s in metrics, and the shared counter store (window, eviction);
  - metrics: counts by route template and status, the latency histogram, unknown routes not leaking paths, progress outcomes, process metrics;
  - an end-to-end scenario through the public API only: two logins, browsing with a cursor, a playback grant, an offline phone and an online tablet, a retried batch, convergence on both devices, and per-device logout.
- **Property-based tests (fast-check).** Hundreds of random event sets from several devices, with frequent timestamp ties and replays, are delivered in random orders through the real repository and SQLite: every order must end in the same state, the one the shared rule picks. A second property checks the rule is a strict total order. This found a real edge case (same device, same timestamp) that is now settled by the event-id tie-break.
- **Contract tests.**
  - The OpenAPI document generated from the shared schemas is snapshot-tested (`apps/api/openapi.json`), and tests require every JSON route to declare a typed response, every non-public route to require a bearer token, and the README's API table to match the real routes.
  - Every response from the app's MSW fake API is validated against the same schemas; a mismatch fails the test, so the fake cannot drift from the real API.
  - **Cross-check:** `apps/mobile/src/contract` starts the real API (child process, scratch database) and runs the app's real API client, local store and sync engine against it: paging the catalog, typed errors carrying the app's correlation ID, two devices syncing and converging, and a real 429 with `Retry-After`.
- **Mobile (Jest + jest-expo + React Native Testing Library + MSW).**
  - Screen tests render the real providers with the real API client against a stateful fake of the API. They cover the catalog (success, empty, errors with retry, timeout, offline, contract violation, infinite scroll, category filter, saved-video fallback), item detail (signed-out, entitled, not entitled, resume, saved details on failure), the player (403, signed out, resume from another device, newer local position beating an older server one, starting over after the end, storage unavailable, stream errors, saving and syncing), login (including rate limiting), account and diagnostics, and the session lifecycle.
  - Offline tests cover a cold start without network, reopening with a previously saved catalog, never persisting user-scoped data, discarding caches from another app version, surviving a corrupted cache, the banner, and progress saved offline and delivered on reconnect (skipping backoff).
  - The local store, migrations and sync engine run against **real SQLite** (in-memory `better-sqlite3` behind the same interface as `expo-sqlite`), so the SQL that ships is the SQL under test: coalescing, strictly increasing timestamps, merging server state under the rule, acknowledging only the delivered event, backoff and `Retry-After`, offline/5xx/429/401/400 handling, single-flight flushing and batching.
  - The progress tracker is tested with a scriptable fake player and fake timers: interval saves only while playing, pause, seek, end, background, unmount, de-duplication, and ignoring time updates until the resume seek lands.
  - Unhandled network requests fail the test.
- **CI.** GitHub Actions runs lint, format, typecheck, both suites with coverage thresholds, and the API production build.

## Next steps

The current scope covers everything the product needs to be correct, reliable and operable. These are the next things worth doing, and why they were left out of a small, self-contained project.

### TV app from the same codebase

**Plan.** Build Android TV and tvOS from this repository instead of a second app:

- Swap `react-native` for [`react-native-tvos`](https://github.com/react-native-tvos/react-native-tvos) through a package alias and add the `@react-native-tvos/config-tv` Expo config plugin; build with `EXPO_TV=1 npx expo prebuild`.
- **Remote and focus:** `TVFocusGuideView` and `hasTVPreferredFocus` for predictable D-pad navigation, visible focus styles on rows, chips and buttons, `useTVEventHandler` for play/pause/seek from the remote, and back mapped to navigation.
- **10-foot layout:** a grid catalog, larger type and TV-safe margins, no gesture-only interactions; screens branch on `Platform.isTV`, and the shared `Screen`, `Button` and `ProgressBar` components gain TV variants.
- **Sign-in:** a device-code flow (the TV shows a short code, the user approves it on their phone, the TV polls for its token), which needs two small endpoints next to `/v1/auth/login`.
- **What carries over unchanged:** the API, contracts, API client, progress store, sync outbox, multi-device rule, query cache and most tests. Resume between phone and TV works out of the box, because a TV is just another device in the rule.

**Why not now.** A TV build needs a custom development build (Expo Go does not run on TV) and TV emulators, which would make the project much heavier to run and review. The architecture already keeps everything below the screen layer platform-agnostic, so this is additive work rather than a rewrite.

### End-to-end tests with Maestro

**Plan.** A handful of [Maestro](https://maestro.mobile.dev) flows for the journeys that matter most:

1. Sign in, browse, open an item, play, background the app, come back, and check it resumes.
2. Airplane mode, watch and leave the player, reconnect, and check the server has the position.
3. Another device saves progress (a `runScript` HTTP call), and the app offers to resume from it.
4. Stop the API, and check the cached catalog, the saved-category fallback and saved details.

**Why Maestro.** Flows are short, readable YAML, so they double as living documentation of the journeys. It drives the real app as a black box through the accessibility tree (no test code inside the app, no native test harness to configure, unlike Detox), waits for elements automatically, which keeps flows stable without manual sleeps, works the same on iOS and Android, and runs locally, in CI on a simulator, or on Maestro Cloud / EAS workflows.

**Why not now.** Meaningful E2E runs need a development build, simulators in CI (a macOS runner for iOS) and a running API, which is slow and costly to keep green for a project this size. The risk they would cover is already well covered: screen tests render the real providers and client, offline and sync behaviour is tested against real SQLite, and the cross-check suite runs the app's real networking and sync code against the real API.

### Production hardening

- **Database:** Postgres instead of SQLite (the progress upsert translates directly), connection pooling, and read replicas for the catalog.
- **Streams:** short-lived signed CDN URLs from the playback endpoint, so a leaked URL expires on its own; a CDN in front of thumbnails and manifests.
- **Auth:** refresh tokens with rotation and an OAuth/OIDC provider instead of local passwords.
- **Rate limiting at scale:** a shared Redis store, plus limits at the edge (API gateway / WAF) for volumetric abuse.
- **Observability:** OpenTelemetry traces across app and API (the correlation ID becomes the trace context), log shipping, dashboards and alerts on error rate, p95 latency, 429s and `progress_events_total{outcome="rejected"}`; a crash reporter in the app.
- **Data lifecycle:** prune `progress_events` by `received_at` (already indexed) after a retention window, and purge expired tokens on a schedule.
- **Catalog caching:** `ETag` / `Cache-Control` on public catalog endpoints so CDNs and the app can revalidate cheaply.
- **Contracts across teams:** if the app and API were owned and deployed separately, consumer-driven contract tests (Pact) on top of the shared schemas and the OpenAPI snapshot.
- **Delivery:** containerised API with probes wired to `/health` and `/ready`; EAS builds and over-the-air updates for the app.
