# Media Library

A small media library product. The **mobile app** (Expo / React Native, iOS and Android) browses a video catalog, plays videos, resumes where you left off on any device and keeps working offline. The **API** (Node.js / Fastify / SQLite) serves the catalog, enforces who can watch what and stores playback progress.

The focus is correctness, reliability and operational quality, not visual design.

- **Catalog:** paginated, filterable by category, readable without an account.
- **Entitlements:** token login; stream URLs are only released to users whose plan covers the item.
- **Resume anywhere:** progress survives backgrounding, crashes and offline periods, syncs with retry-safe writes, and a documented rule decides which device wins.
- **Offline:** the catalog, details and your progress stay available; progress syncs when the connection returns.
- **Operations:** timeouts and clear errors, structured logs, Prometheus metrics, and a correlation ID from the app through every request.
- **Security:** validated input, auth on every write, rate limiting, no secrets in code.

## Repository layout

```
apps/api/            Fastify API: src/{plugins,modules,db}, drizzle/ migrations, openapi.json, test/
apps/mobile/         Expo app: src/{app (routes), features, lib, providers, components, contract, test}
packages/contracts/  zod schemas + types shared by the app and the API
docs/                ADRs, cache policy, failure modes, testing
```

## Quick start

Requires **Node.js 22.12+** (`nvm use`) and, for the app, **Expo Go** on a device on the same Wi-Fi, or an iOS Simulator / Android Emulator. No Docker; the database is a local SQLite file, and every native module ships with Expo Go.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # optional; sets the demo password
npm run db:reset                         # migrate + seed
npm run dev:api                          # http://localhost:3000
npm run dev:mobile                       # second terminal; press i / a or scan the QR code
```

The app finds the API on port 3000 of the machine running Expo. To override it, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.

**Demo accounts:** `free-user` (free items only) and `premium-user` (everything), both with password `demo-password` when you copied `.env.example`. Otherwise `db:reset` generates a password and prints it.

**Try it**

- **API docs:** interactive OpenAPI at <http://localhost:3000/docs>, and metrics at `/metrics`.
- **Multi-device:** sign in as the same user on two simulators, watch part of a video on one, then open it on the other. It offers to resume.
- **Offline:** browse, then turn on airplane mode or stop the API. Cached content and positions stay; progress syncs on reconnect.
- **Diagnostics:** **Account → Diagnostics** shows connectivity, request count, error rate, slowest route and pending sync.

## Scripts and configuration

`npm run verify` (lint + typecheck + test, what CI runs) · `npm test` · `npm run lint` · `npm run typecheck` · `npm run format` · `npm run db:reset`. API only (`-w @media-library/api`): `build`, `start`, `test:coverage`, `db:generate`, `db:migrate`, `db:seed`.

The API is configured through the environment, and every value has a safe default (see `apps/api/.env.example`). The main ones:

- `PORT`, `HOST`, `LOG_LEVEL`, `LOG_PRETTY`, `DATABASE_PATH`.
- `AUTH_TOKEN_TTL_HOURS` (default 168).
- `DEMO_USER_PASSWORD`.
- `RATE_LIMIT_WINDOW_SEC` (60), `RATE_LIMIT_LOGIN_MAX` (10) and `RATE_LIMIT_WRITE_MAX` (120).

`.env` files are git-ignored.

## Architecture and decisions

```
┌──────────── Mobile app (Expo) ────────────┐          ┌──────────────── API (Fastify) ────────────────┐
│ Screen → TanStack Query → ApiClient       │ ───────▶ │ correlation ID → zod validation → auth →      │
│   correlation ID, timeout, typed errors,  │          │ rate limit → route → repository → SQLite      │
│   response validated against contracts    │ ◀─────── │ contract-checked response · error envelope    │
│ On-device SQLite: progress + sync outbox  │   JSON   │ pino JSON logs · Prometheus /metrics          │
│ Persisted catalog cache · NetInfo         │          │ OpenAPI docs generated from the schemas       │
└───────────────────────────────────────────┘          └───────────────────────────────────────────────┘
                     ▲                 packages/contracts (zod)                 ▲
                     └──────────────── single source of truth ─────────────────┘
```

- **Shared contracts** ([ADR 0001](docs/adr/0001-monorepo-and-stack.md)). One npm-workspaces repo. The zod schemas in `packages/contracts` validate API input and output, are checked by the app at runtime, and generate the OpenAPI document. A breaking change fails typecheck on both sides.
- **Failing safely.**
  - **API:** one error envelope (`{ error: { code, message, correlationId } }`) with no internals leaked, plus timeouts and a body size limit.
  - **App:** a 10 s timeout per request, typed errors mapped to clear messages with Retry, and retries only for transient errors, with jittered backoff and `Retry-After` honoured.
- **Correlation ID.** The app mints one per request. The API logs it on every line, echoes it, and returns it in errors. Error screens show it as `Ref: abcd1234`.
- **Auth and entitlements** ([ADR 0002](docs/adr/0002-auth-and-entitlements.md)). Opaque random tokens, stored only as a SHA-256 hash, so they're revocable. Passwords use scrypt, with generic 401s. The stream URL is only returned by `/playback` after a tier check, with `no-store`. The app keeps the session in the keychain or keystore.
- **Rate limiting** ([ADR 0004](docs/adr/0004-rate-limiting.md)). Login is limited per (IP, username); progress writes per user, across both endpoints. Reads are never limited. A 429 comes with `Retry-After`, which the app's sync queue honours.
- **Progress and the multi-device rule** ([ADR 0003](docs/adr/0003-progress-and-multi-device.md)).
  - **Rule:** the most recent observation by device clock wins, not the latest arrival; ties break on device ID, then event ID.
  - **Atomic and idempotent:** the API applies the rule in one atomic SQL upsert, and a replayed event ID is a no-op.
  - **Guards:** events dated more than 5 minutes in the future are rejected, and positions are clamped to the video's length.
  - **Local first:** the app saves to on-device SQLite and an outbox first. It syncs in batches with backoff, and only forgets an event once the server has handled it.
  - **When it saves:** every 10 s, on pause, after a seek, at the end, on backgrounding and when leaving the player.
- **Offline first** ([cache policy](docs/cache-policy.md)).
  - **Saved catalog:** only public catalog data is persisted. The cache is versioned, bounded, and expires after 7 days.
  - **Fallbacks:** uncached categories and failed detail refreshes fall back to saved data, with a notice.
  - **Network awareness:** NetInfo pauses requests while offline and triggers sync on reconnect.
- **Keyset pagination.** An opaque cursor over `(created_at, id)` keeps pages stable as items are added, and costs O(limit) per page.

| Trade-off                             | Why                                                | Production path                                                             |
| ------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| SQLite                                | Zero setup, real SQL and migrations, fast test DBs | Postgres; the schema and upserts carry over                                 |
| Opaque hashed tokens                  | Revocable, nothing to sign or rotate               | Refresh tokens, an OIDC provider                                            |
| Last observation wins by device clock | Matches what the user did last, works offline      | Bounded by the skew guard; server-assigned order if clocks can't be trusted |
| Expo Go compatible                    | Anyone can run the app in minutes                  | Dev builds unlock TV and native E2E tooling ([next steps](#next-steps))     |
| In-memory rate-limit counters         | No extra infrastructure for one API process        | Redis store shared by instances                                             |
| Static stream URLs                    | The samples are public test assets                 | Short-lived signed CDN URLs                                                 |

## API

Full reference at `/docs`. The OpenAPI document is committed as `apps/api/openapi.json` and snapshot-tested.

| Method | Path                     | Auth   | Description                                                                    |
| ------ | ------------------------ | ------ | ------------------------------------------------------------------------------ |
| GET    | `/health`                | –      | Liveness                                                                       |
| GET    | `/ready`                 | –      | Readiness (database check)                                                     |
| GET    | `/metrics`               | –      | Prometheus metrics                                                             |
| GET    | `/v1/categories`         | –      | Categories                                                                     |
| GET    | `/v1/items`              | –      | Catalog page: `limit`, `cursor`, `category` → `{ data, nextCursor }`           |
| GET    | `/v1/items/:id`          | –      | Item details                                                                   |
| GET    | `/v1/items/:id/playback` | Bearer | Stream URL if the plan covers the item (403 otherwise)                         |
| POST   | `/v1/auth/login`         | –      | `{ username, password }` → `{ token, expiresAt, user }` (rate limited)         |
| POST   | `/v1/auth/logout`        | Bearer | Revoke the token                                                               |
| GET    | `/v1/me`                 | Bearer | Current user                                                                   |
| GET    | `/v1/me/progress`        | Bearer | Progress for `itemIds`, or recently watched                                    |
| PUT    | `/v1/me/progress/:id`    | Bearer | One event → `applied` / `stale` / `duplicate` + canonical state (rate limited) |
| POST   | `/v1/me/progress/batch`  | Bearer | Up to 100 events, resolved independently (rate limited)                        |

## Data model

| Table               | Purpose                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `categories`        | Catalog categories (`slug` unique)                                                                        |
| `items`             | Videos: metadata, `duration_sec`, `stream_url`, `required_tier`; indexed for keyset pagination and filter |
| `users`             | Demo users with `tier` and a scrypt `password_hash`                                                       |
| `auth_tokens`       | SHA-256 of each bearer token, with `expires_at`                                                           |
| `playback_progress` | Canonical position per (user, item), with the observation's time, device and last event                   |
| `progress_events`   | Every distinct event per (user, event id): the idempotency ledger and audit trail                         |

On the device, `expo-sqlite` holds `progress` (what the player resumes from), `outbox` (one pending event per item) and `meta` (the install's device ID). It is migrated with `PRAGMA user_version`. API migrations live in `apps/api/drizzle/` and run on start.

## Observability

- **Logs:** JSON lines on both sides with the correlation ID (pino on the API; `{ ts, level, event, sessionId }` in the app). Authorization headers are redacted.
- **Metrics:** `GET /metrics` exposes:
  - `http_requests_total` and `http_request_duration_seconds`, by method, route template and status (error rate comes from the status label);
  - `progress_events_total` by outcome;
  - process stats.
- **App-side metrics:** request count, error rate and p50/p95 per route, recorded in `lib/telemetry.ts`, the place where a telemetry SDK would plug in.

```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))   # error rate
histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket[5m])))  # p95 per route
```

## Failure modes

The most common cases are below; [docs/failure-modes.md](docs/failure-modes.md) covers 17.

| Failure                  | Behaviour                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Offline / API down       | Cached content stays usable with a notice; requests pause or retry; progress queues and syncs later |
| Timeout / 5xx            | Clear message with Retry and a `Ref:` that matches the API logs                                     |
| Token expired            | Signed out, user caches cleared; queued progress waits for the next sign-in                         |
| Duplicate or late writes | Idempotent by event ID; older observations are acknowledged as `stale`                              |
| Device clock wrong       | More than 5 min ahead is rejected; a device never loses to its own older save                       |
| Rate limited             | 429 with `Retry-After`, honoured by the sync queue and explained at sign-in                         |

## Testing

`npm test` runs everything. CI enforces ≥90% line and ≥85% branch coverage on both sides. Details are in [docs/testing.md](docs/testing.md).

- **API integration:** every route through `app.inject()` against fresh in-memory SQLite, covering pagination, auth, entitlements, progress (idempotency, ordering, ties, skew, concurrency), rate limits, metrics, and a two-device end-to-end scenario.
- **Property-based:** fast-check sends random event sets in random orders through the real repository; all orders must converge. This found the same-timestamp edge case now settled by the event-ID tie-break.
- **Contract:** a snapshot of the OpenAPI document, and checks that every route declares typed responses and auth and that the README API table matches the routes. The app's fake API is validated against the same schemas.
- **App:** screens with real providers and client against a stateful MSW fake. The progress store and sync engine run on real SQLite, and the tracker runs against a scriptable fake player.
- **Cross-check:** the app's real client and sync engine against the real API, started as a child process: browsing, typed errors, two devices converging and a real 429.

## Next steps

Left out on purpose to keep this a small, easy-to-run project.

- **TV app from the same codebase.**
  - **Build:** `react-native-tvos` through a package alias, the `@react-native-tvos/config-tv` plugin, and `EXPO_TV=1 npx expo prebuild`.
  - **Screens:** D-pad focus with `TVFocusGuideView` and remote events, a 10-foot grid layout, and device-code sign-in.
  - **What carries over:** everything below the screens. A TV is simply another device under the progress rule.
  - **Why later:** it needs custom dev builds and TV emulators (Expo Go can't run on TV), which makes the project much heavier to run and review.
- **End-to-end tests with Maestro.**
  - **Flows:** resume after backgrounding, offline save then sync, resuming from another device, and the API down.
  - **Why Maestro:** readable YAML flows, black-box testing through the accessibility tree (no harness inside the app, unlike Detox), built-in waiting for stability, the same on iOS and Android, and it runs locally, in CI or on EAS.
  - **Why later:** it needs dev builds, simulators in CI (macOS runners) and a running API. That's slow and costly for this size, and the risk is largely covered by the cross-check and real-SQLite tests.
- **Production hardening.**
  - **Data and auth:** Postgres, signed CDN stream URLs, refresh tokens and OIDC.
  - **Scale and observability:** a Redis rate-limit store plus edge limits, OpenTelemetry traces (with the correlation ID as trace context), dashboards and alerts.
  - **Lifecycle and caching:** pruning `progress_events`, `ETag` caching on the catalog, and Pact if the app and API ship independently.
  - **Delivery:** containers wired to `/health` and `/ready`, plus EAS builds and over-the-air updates.
