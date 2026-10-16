# Media Library

A small media library product with two parts. The **mobile app** (Expo / React Native, iOS and Android) browses a catalog of videos, plays them, and keeps working offline. The **API** (Node.js / Fastify / SQLite) serves the catalog, enforces who can watch what, and stores playback progress.

The focus is correctness, reliability and operational quality, not visual design.

> **Status:** Phases 1–4 are done: the foundation; catalog browsing, token auth and entitlement-checked playback; playback progress with resume, idempotent sync and a multi-device rule; and offline use (persisted catalog, network-aware sync) with metrics, a cache policy and documented failure modes. Phase 5 (optional extras) is next; see [Roadmap](#roadmap).

---

## Repository layout

```
apps/
  api/                 Fastify API (TypeScript, SQLite + Drizzle)
    src/
      app.ts           buildApp() factory, shared by the server and the tests
      server.ts        process entry: config, migrations, listen, graceful shutdown
      config.ts        environment parsed and validated with zod (fail fast)
      plugins/         correlation-id, error-handler, auth (bearer tokens), metrics (Prometheus)
      lib/             errors, password hashing, token helpers
      modules/         feature modules (health, catalog, auth, progress): routes + service + repository
      db/              schema, client, migrator, seed, maintenance CLI
    drizzle/           generated SQL migrations (committed)
    test/              integration tests (in-memory SQLite per test)
  mobile/              Expo app (TypeScript, Expo Router)
    src/
      app/             routes (screens) only
      features/        feature code (catalog, item, player, auth, progress, diagnostics): data hooks + screens
      lib/             api client, logger, telemetry, network status, query persistence, on-device database, storage, config
      providers/       app-wide providers (query client, api client, auth session, progress)
      components/      shared UI primitives
      test/            MSW fake API, fixtures, render helpers, in-memory SQLite, fake video player
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

Nothing else: the database is a local SQLite file and no Docker is needed.

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

Check the API by hand:

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
```

To see the multi-device rule in the app, sign in as the same user on two simulators (or a simulator and a device). Watch a video on one, leave the player, then open the same video on the other: it offers to resume where the first device stopped.

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

| Variable               | Default                   | Notes                                                        |
| ---------------------- | ------------------------- | ------------------------------------------------------------ |
| `PORT` / `HOST`        | `3000` / `0.0.0.0`        | Listens on all interfaces so devices on the LAN can reach it |
| `LOG_LEVEL`            | `info`                    | pino level (`silent` in tests)                               |
| `LOG_PRETTY`           | `false`                   | Human-readable logs for local development                    |
| `DATABASE_PATH`        | `./data/media-library.db` | SQLite file (git-ignored)                                    |
| `AUTH_TOKEN_TTL_HOURS` | `168` (7 days)            | Lifetime of issued bearer tokens                             |
| `DEMO_USER_PASSWORD`   | unset (generated)         | Password given to seeded demo users (min. 8 chars)           |

## Architecture overview

```
┌──────────── Mobile app (Expo) ────────────┐          ┌──────────────── API (Fastify) ────────────────┐
│ Screen → TanStack Query hook              │ HTTP(S)  │ genReqId: reuse/mint correlation ID           │
│        → ApiClient                        │ ───────▶ │ zod validation (contracts)                    │
│           • X-Correlation-Id per request  │          │ route → repository → SQLite (Drizzle)         │
│           • hard timeout (AbortController)│ ◀─────── │ response serialised against contract schema   │
│           • typed errors                  │  JSON    │ error handler → { error: {code, message,      │
│           • response validated (zod)      │          │                  correlationId} }             │
│ Structured JSON logs (sessionId, corrId)  │          │ pino JSON logs, every line has correlationId  │
└───────────────────────────────────────────┘          └───────────────────────────────────────────────┘
                     ▲                 packages/contracts (zod)                 ▲
                     └──────────────── single source of truth ─────────────────┘
```

Key decisions, with full rationale in [ADR 0001](docs/adr/0001-monorepo-and-stack.md):

- **Shared contracts.** Request and response shapes are zod schemas in `packages/contracts`. The API validates input and serialises output with them, and the app validates every response at runtime. A breaking change fails typecheck in both apps, and at runtime the app shows an "Unexpected response" error instead of rendering bad data.
- **Correlation IDs end to end.** The app mints an ID per request and sends it as `X-Correlation-Id`. The API reuses it if it is well formed and mints one otherwise. It binds the ID to every log line for that request, echoes it in the response header, and includes it in every error body. Error screens in the app show a short `Ref:` so a user report can be traced to server logs.
- **Safe failure.**
  - The API returns one error envelope for every failure and never leaks internals on 5xx. It also sets connection and request timeouts and a body size limit.
  - The app applies a 10s timeout to every request, covering both headers and body. Errors are typed (`TimeoutError`, `NetworkError`, `HttpError`, `InvalidResponseError`) and mapped to clear user-facing messages with a retry action.
  - Only transient errors are retried (timeouts, network failures, 5xx, 408 and 429), with capped, jittered exponential backoff.
- **Authentication and entitlements.** Full rationale in [ADR 0002](docs/adr/0002-auth-and-entitlements.md).
  - Logging in issues an opaque, random 256-bit bearer token. The API stores only its SHA-256 hash, together with an expiry.
  - Passwords are stored as salted scrypt hashes. Login compares in constant time and returns the same generic 401 for an unknown user or a wrong password.
  - Reading the catalog is public. Every write, and access to a stream, requires a token.
  - The stream URL is never part of the catalog. It is only returned by `/v1/items/:id/playback`, after checking that the user's tier covers the item (`canWatch` lives in the shared contracts). It is sent with `Cache-Control: no-store`.
  - The app keeps the session in the platform keychain/keystore (`expo-secure-store`) and attaches the token to requests.
  - When an authenticated request gets a 401, the app drops the session and clears every user-scoped cache entry (stream URLs). A failed profile refresh while offline keeps the cached session.
- **Playback progress and the multi-device rule.** Full rationale in [ADR 0003](docs/adr/0003-progress-and-multi-device.md).
  - **Rule:** the most recent _observation_ wins, by the device clock time it was recorded at (not arrival time). Ties go to the greater device id. A phone that syncs an hour-old offline session cannot overwrite what a tablet watched since. Rewinding is allowed when it is newer.
  - **Atomic and idempotent:** the API applies the rule in one SQL upsert. Each event carries a client UUID, so retries and replays are acknowledged as `duplicate` without being applied twice. Every write returns the canonical state.
  - **Guards:** events stamped more than 5 minutes ahead of the server clock are rejected (`422 CLOCK_SKEW`). Positions are clamped to the item's duration, and the item must be in the user's plan.
  - **Local first:** the app writes every save to on-device SQLite (`expo-sqlite`) and an outbox in one transaction, then syncs through the batch endpoint. The outbox keeps one pending event per item, retries with capped, jittered backoff, and only forgets an event once the server has resolved it.
  - **When it saves:** every 10 s while playing, on pause, after a seek, at the end, when the app is backgrounded, and when the player closes. It flushes after each save, on launch and sign-in, on return to foreground, and as soon as connectivity returns (skipping any retry backoff).
  - **Resume:** the player briefly pulls the server's latest position (3 s timeout), merges it under the same rule, and resumes from the winner. It falls back to local state when offline, and starts over below 5 s or once 95% has been watched.
- **Offline first.** Full policy in [docs/cache-policy.md](docs/cache-policy.md).
  - The catalog (lists, categories, item details) is persisted to AsyncStorage with TanStack Query's persister, so the app opens offline with what it last loaded. Only public catalog data is written to disk (an allow-list), never stream URLs or anything user-scoped. The cache is versioned (schema + app version), bounded (first pages of each list), expires after 7 days, and is discarded if unreadable.
  - Thumbnails use expo-image's disk cache.
  - NetInfo drives TanStack Query's online manager: offline, requests pause instead of failing and resume on reconnect. A banner says the app is offline; screens explain what needs a connection (loading more, playback) and keep showing what is cached, including the last position.
- **Keyset pagination.** The catalog is ordered by `(created_at DESC, id DESC)` and paginated with an opaque cursor (base64url of the last row's position). Unlike `OFFSET`, pages stay stable while items are inserted, and each page costs O(limit) thanks to composite indexes. Malformed cursors return 400.
- **Liveness vs readiness.** `/health` reports that the process is up. `/ready` checks the database and returns 503 when it is unavailable.

## API (current)

| Method | Path                     | Auth   | Description                                                                                                                            |
| ------ | ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | –      | Liveness                                                                                                                               |
| GET    | `/ready`                 | –      | Readiness (database check)                                                                                                             |
| GET    | `/metrics`               | –      | Prometheus metrics (see [Observability](#observability))                                                                               |
| GET    | `/v1/categories`         | –      | All categories, alphabetical                                                                                                           |
| GET    | `/v1/items`              | –      | Catalog, newest first. `limit` 1–50 (default 20), `cursor` (from `nextCursor`), `category` (slug). Returns `{ data, nextCursor }`      |
| GET    | `/v1/items/:id`          | –      | Item metadata and duration                                                                                                             |
| GET    | `/v1/items/:id/playback` | Bearer | Stream URL, only if the user's tier covers the item (401 without a valid token, 403 if not entitled)                                   |
| POST   | `/v1/auth/login`         | –      | `{ username, password }` → `{ token, expiresAt, user }`                                                                                |
| POST   | `/v1/auth/logout`        | Bearer | Revokes the token (204)                                                                                                                |
| GET    | `/v1/me`                 | Bearer | Current user                                                                                                                           |
| GET    | `/v1/me/progress`        | Bearer | Progress for `itemIds` (comma-separated, max 100), or the most recently watched items (`limit` 1–100, default 20)                      |
| PUT    | `/v1/me/progress/:id`    | Bearer | One event `{ eventId, positionSec, recordedAt, deviceId }` → `{ status: applied/stale/duplicate, progress }`. 404/403/422 on rejection |
| POST   | `/v1/me/progress/batch`  | Bearer | 1–100 events (each with `itemId`) → per-event `{ eventId, status, progress \| reason }`, in request order                              |

Errors always look like:

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

## Data model (current)

| Table               | Columns                                                                                                                                                   | Notes                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`        | `id` PK, `slug` unique, `name`                                                                                                                            |                                                                                                                                               |
| `items`             | `id` PK (uuid), `title`, `description`, `category_id` FK, `duration_sec`, `thumbnail_url`, `stream_url`, `required_tier` (`free`/`premium`), `created_at` | Indexed on `(created_at, id)` and `(category_id, created_at, id)` for keyset pagination and the category filter                               |
| `users`             | `id` PK, `username` unique, `display_name`, `tier` (`free`/`premium`), `password_hash` (`scrypt$salt$hash`), `created_at`                                 |                                                                                                                                               |
| `auth_tokens`       | `token_hash` PK (SHA-256 of the bearer token), `user_id` FK (cascade), `created_at`, `expires_at`                                                         | Expired tokens are rejected and purged on login; indexed on `user_id` and `expires_at`                                                        |
| `playback_progress` | PK (`user_id`, `item_id`), `position_sec`, `client_recorded_at`, `device_id`, `last_event_id`, `updated_at`                                               | Canonical position. Only replaced by a newer observation (`client_recorded_at`, then `device_id`). Indexed on `(user_id, client_recorded_at)` |
| `progress_events`   | PK (`user_id`, `event_id`), `item_id`, `position_sec`, `client_recorded_at`, `device_id`, `received_at`, `outcome` (`applied`/`stale`)                    | Idempotency ledger and audit trail of every distinct event                                                                                    |

On the device, the app keeps its own SQLite database (`expo-sqlite`), migrated with `PRAGMA user_version` (see `apps/mobile/src/lib/db/database.ts`):

| Table      | Columns                                                                                                                        | Notes                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `progress` | PK (`user_id`, `item_id`), `position_sec`, `duration_sec`, `recorded_at`, `device_id`                                          | What the player resumes from; server state is merged in under the same rule |
| `outbox`   | PK (`user_id`, `item_id`), `event_id`, `position_sec`, `recorded_at`, `device_id`, `attempts`, `next_attempt_at`, `last_error` | One pending event per item; removed only once the server resolves it        |
| `meta`     | `key` PK, `value`                                                                                                              | The per-install `device_id`                                                 |

Migrations live in `apps/api/drizzle/`. They are generated from `src/db/schema.ts` with `npm run db:generate -w @media-library/api` and applied automatically on server start (or with `db:migrate`). The seed uses publicly hosted sample HLS/MP4 streams, and several items share a stream on purpose. Item IDs are stable across resets.

## Observability

**Logs.** Both sides write structured JSON, one object per line.

- API: pino, with the request's `correlationId` on every line (and `userId` once authenticated). Authorization headers are redacted. Each request logs `incoming request` and `request completed` with status and `responseTime`; domain events (login, playback denied, progress batch outcomes) are logged with context.
- App: `{ ts, level, event, sessionId, … }`. Every HTTP request logs `http.response` or `http.error` with method, path, status, duration, error kind and correlation ID. Sync, cache and player events are logged too (`progress.flush_deferred`, `progress.reconnected`, `cache.unreadable`, `player.error`…).
- The correlation ID is created in the app per request, sent as `X-Correlation-Id`, reused by the API for its logs, echoed in the response header and in error bodies, and shown to the user as `Ref: abcd1234` on error screens. Grepping that reference in API logs finds the request.

**Metrics.** `GET /metrics` serves the Prometheus text format:

| Metric                          | Type      | Labels                                       | Use                                                       |
| ------------------------------- | --------- | -------------------------------------------- | --------------------------------------------------------- |
| `http_requests_total`           | counter   | `method`, `route`, `status_code`             | Request count; error rate from the status label           |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code`             | Latency percentiles                                       |
| `progress_events_total`         | counter   | `outcome` (applied/stale/duplicate/rejected) | Sync health: a spike in `stale` or `rejected` is a signal |
| `process_*`, `nodejs_*`         | various   |                                              | CPU, memory, event loop lag, GC                           |

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

**App metrics.** The API client reports every request (method, route template, status, outcome, duration) to `lib/telemetry.ts`, which aggregates count, error rate and p50/p95 latency per route. That is the hook point for a real telemetry SDK (OpenTelemetry, Sentry, Datadog): forward each record instead of only aggregating. The numbers, connectivity, the sync backlog and the session ID are visible in the app under **Account → Diagnostics**, which also helps support.

## Failure modes

| Failure                              | What the user sees                                                                                                                                                                                                             | What the system does                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device offline                       | Offline banner; cached catalog and details; "playback needs a connection"                                                                                                                                                      | Queries pause and resume on reconnect. Progress is saved locally and queued; the queue is flushed on reconnect, skipping backoff.                                         |
| API down / unreachable               | Cached lists keep working. A list never loaded (e.g. a new category) shows matching saved videos with a "Couldn't reach the server" notice and Retry; with nothing saved, a full-screen "Can't reach the server" with a `Ref:` | GETs retry with capped, jittered backoff (transient errors only). Progress stays in the outbox and retries with backoff (2 s → 5 min) plus on foreground and reconnect.   |
| Slow API / timeout                   | "Taking too long" with a retry                                                                                                                                                                                                 | Every request has a 10 s hard timeout (headers and body). The resume lookup waits at most 3 s, then uses local progress. The API has its own request/connection timeouts. |
| 5xx / unexpected error               | "Server problem" with a `Ref:`                                                                                                                                                                                                 | API logs the error with the correlation ID and returns a generic envelope (no internals).                                                                                 |
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

## Production improvements

- **Database:** Postgres instead of SQLite (the progress upsert translates directly: `ON CONFLICT … DO UPDATE … WHERE`), connection pooling, and read replicas for the catalog.
- **Streams:** short-lived signed CDN URLs from the playback endpoint, so a leaked URL expires on its own; a CDN in front of thumbnails and manifests.
- **Auth:** refresh tokens with rotation, rate limiting on login (planned in Phase 5), and an OAuth/OIDC provider instead of local passwords.
- **Observability:** OpenTelemetry traces across app and API (the correlation ID becomes the trace context), log shipping, dashboards and alerts on error rate, p95 latency and `progress_events_total{outcome="rejected"}`; a crash reporter in the app.
- **Data lifecycle:** prune `progress_events` by `received_at` (already indexed) after a retention window, and purge expired tokens on a schedule.
- **Catalog:** HTTP caching (`ETag` / `Cache-Control`) on public catalog endpoints so CDNs and the app can revalidate cheaply.
- **Delivery:** containerised API with health/readiness probes wired to `/health` and `/ready`, EAS builds and OTA updates for the app.

## Testing

```bash
npm test                                           # everything
npm run test:coverage -w @media-library/api        # API with coverage thresholds
npm run test:coverage -w @media-library/mobile     # app with coverage thresholds
```

- **API (Vitest).** Integration tests drive the real app through `app.inject()`, each against a fresh, migrated in-memory SQLite database. They cover:
  - health and readiness (including DB failure), the error envelope, correlation-ID propagation, and not leaking internals;
  - pagination: walking every page exactly once, timestamp ties, inserts between pages, malformed cursors, the category filter;
  - auth: login, generic errors, body validation, token hashing, expiry and purge, logout revocation;
  - entitlements: 401, 403, and free and premium users playing free and premium items;
  - progress: first write, replayed event ids (single and whole batch), older events arriving late, rewinds, timestamp tie-break in both arrival orders, clock-skew rejection and tolerance, clamping, 30 concurrent writes converging on the newest, per-user idempotency, the audit trail, mixed batch outcomes in order, batch size limits, listing and filtering, and a two-device offline scenario;
  - metrics: request counts by route template and status, latency histogram, unknown routes not leaking paths, progress outcomes, process metrics, scrapes not counting themselves;
  - an end-to-end scenario through the public API only: two logins, browsing with a cursor, a playback grant, an offline phone and an online tablet, a retried batch, convergence on both devices, and per-device logout.
- **Mobile (Jest + jest-expo + React Native Testing Library + MSW).**
  - Screen tests render real providers with the real API client against a stateful MSW fake of the API (same contracts). They cover:
    - catalog: success, empty, server error with retry, timeout, offline, contract violation, infinite scroll, load-more failure with retry, category filter;
    - item detail: signed-out, entitled and not-entitled states;
    - player: playing, 403, signed out, resuming from another device's position, a newer unsynced local position beating an older server one, starting over after the end, storage unavailable, stream errors, saving and syncing while watching;
    - progress in the UI: resume button and time left on the detail screen, progress bars on catalog rows;
    - progress provider: delivering events queued before the app closed, catching up on return to foreground, staying quiet while signed out, storage failures;
    - login: success, wrong credentials, connectivity;
    - account and sign-out;
    - session: restore, refresh, offline and 401 handling;
    - offline: cold start without network then loading on reconnect, reopening with the catalog saved by a previous session, never persisting user-scoped data, discarding a cache from another app version, surviving a corrupted cache, item details from cache, the player's offline message, the banner, progress saved offline and delivered on reconnect, and skipping a retry backoff on reconnect;
    - diagnostics: request metrics, connectivity and the sync backlog on the account screen.
  - The local store, migrations and sync engine run against **real SQLite** (in-memory `better-sqlite3` behind the same interface as `expo-sqlite`), so the SQL that ships is the SQL under test. They cover coalescing, strictly increasing timestamps, merging server state under the rule, acknowledging only the delivered event, backoff and retry timers, offline/5xx/429/401/400 handling, single-flight flushing, batching over 100 events and pulling other devices' progress.
  - The progress tracker is tested with a scriptable fake player and fake timers: interval saves only while playing, pause, seek, end, background, unmount, de-duplication, and ignoring time updates until the resume seek lands.
  - Unit tests cover the API client (timeouts, cancellation, error mapping, header propagation, metrics reporting), the retry policy, the logger, config resolution, formatting, the resume rule, the persistence allow-list and trimming, NetInfo → online state mapping, and the metrics aggregator.
  - Unhandled network requests fail the test.
- **CI.** GitHub Actions runs lint, format, typecheck, both suites with coverage thresholds, and the API production build.

## Roadmap

| Phase | Scope                                                                                                                                                                                              | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Foundation: monorepo, contracts, API skeleton (config, logging, correlation IDs, errors, health, DB + migrations + seed), catalog first page, app skeleton (API client, catalog screen), tests, CI | ✅     |
| 2     | Catalog and auth: cursor pagination, category filter, item detail, token auth, entitlement-checked playback endpoint, basic player                                                                 | ✅     |
| 3     | Playback and progress: player with resume, progress tracking across background and interruptions, idempotent writes, multi-device rule, on-device progress store and sync outbox                   | ✅     |
| 4     | Offline and observability: persisted catalog cache, network awareness (offline banner, sync on reconnect), metrics endpoint, app telemetry, documented cache policy and failure modes              | ✅     |
| 5     | Optional: rate limiting, contract tests, TV form-factor plan                                                                                                                                       | ⏳     |
