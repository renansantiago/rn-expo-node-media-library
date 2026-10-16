# Media Library

A small media library product with two parts. The **mobile app** (Expo / React Native, iOS and Android) browses a catalog of videos, plays them, and keeps working offline. The **API** (Node.js / Fastify / SQLite) serves the catalog, enforces who can watch what, and stores playback progress.

The focus is correctness, reliability and operational quality, not visual design.

> **Status:** Phases 1–2 are done: the foundation, plus catalog browsing (pagination, category filter, details), token auth and entitlement-checked playback. See [Roadmap](#roadmap) for what comes next.

---

## Repository layout

```
apps/
  api/                 Fastify API (TypeScript, SQLite + Drizzle)
    src/
      app.ts           buildApp() factory, shared by the server and the tests
      server.ts        process entry: config, migrations, listen, graceful shutdown
      config.ts        environment parsed and validated with zod (fail fast)
      plugins/         correlation-id, error-handler, auth (bearer tokens)
      lib/             errors, password hashing, token helpers
      modules/         feature modules (health, catalog, auth): routes + service + repository
      db/              schema, client, migrator, seed, maintenance CLI
    drizzle/           generated SQL migrations (committed)
    test/              integration tests (in-memory SQLite per test)
  mobile/              Expo app (TypeScript, Expo Router)
    src/
      app/             routes (screens) only
      features/        feature code (catalog, item, player, auth): data hooks + screens
      lib/             api client, logger, config, storage, formatting, error mapping
      providers/       app-wide providers (query client, api client, auth session)
      components/      shared UI primitives
      test/            MSW server, fixtures, render helpers
packages/
  contracts/           zod schemas + TS types shared by the app and the API
docs/
  adr/                 architecture decision records
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
- **Keyset pagination.** The catalog is ordered by `(created_at DESC, id DESC)` and paginated with an opaque cursor (base64url of the last row's position). Unlike `OFFSET`, pages stay stable while items are inserted, and each page costs O(limit) thanks to composite indexes. Malformed cursors return 400.
- **Liveness vs readiness.** `/health` reports that the process is up. `/ready` checks the database and returns 503 when it is unavailable.

## API (current)

| Method | Path                     | Auth   | Description                                                                                                                       |
| ------ | ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health`                | –      | Liveness                                                                                                                          |
| GET    | `/ready`                 | –      | Readiness (database check)                                                                                                        |
| GET    | `/v1/categories`         | –      | All categories, alphabetical                                                                                                      |
| GET    | `/v1/items`              | –      | Catalog, newest first. `limit` 1–50 (default 20), `cursor` (from `nextCursor`), `category` (slug). Returns `{ data, nextCursor }` |
| GET    | `/v1/items/:id`          | –      | Item metadata and duration                                                                                                        |
| GET    | `/v1/items/:id/playback` | Bearer | Stream URL, only if the user's tier covers the item (401 without a valid token, 403 if not entitled)                              |
| POST   | `/v1/auth/login`         | –      | `{ username, password }` → `{ token, expiresAt, user }`                                                                           |
| POST   | `/v1/auth/logout`        | Bearer | Revokes the token (204)                                                                                                           |
| GET    | `/v1/me`                 | Bearer | Current user                                                                                                                      |

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

| Table         | Columns                                                                                                                                                   | Notes                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `categories`  | `id` PK, `slug` unique, `name`                                                                                                                            |                                                                                                                 |
| `items`       | `id` PK (uuid), `title`, `description`, `category_id` FK, `duration_sec`, `thumbnail_url`, `stream_url`, `required_tier` (`free`/`premium`), `created_at` | Indexed on `(created_at, id)` and `(category_id, created_at, id)` for keyset pagination and the category filter |
| `users`       | `id` PK, `username` unique, `display_name`, `tier` (`free`/`premium`), `password_hash` (`scrypt$salt$hash`), `created_at`                                 |                                                                                                                 |
| `auth_tokens` | `token_hash` PK (SHA-256 of the bearer token), `user_id` FK (cascade), `created_at`, `expires_at`                                                         | Expired tokens are rejected and purged on login; indexed on `user_id` and `expires_at`                          |

Migrations live in `apps/api/drizzle/`. They are generated from `src/db/schema.ts` with `npm run db:generate -w @media-library/api` and applied automatically on server start (or with `db:migrate`). The seed uses publicly hosted sample HLS/MP4 streams, and several items share a stream on purpose. Item IDs are stable across resets.

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
  - entitlements: 401, 403, and free and premium users playing free and premium items.
- **Mobile (Jest + jest-expo + React Native Testing Library + MSW).**
  - Screen tests render real providers with the real API client against a stateful MSW fake of the API (same contracts). They cover:
    - catalog: success, empty, server error with retry, timeout, offline, contract violation, infinite scroll, load-more failure with retry, category filter;
    - item detail: signed-out, entitled and not-entitled states;
    - player: playing, 403, signed out;
    - login: success, wrong credentials, connectivity;
    - account and sign-out;
    - session: restore, refresh, offline and 401 handling.
  - Unit tests cover the API client (timeouts, cancellation, error mapping, header propagation), the retry policy, the logger, config resolution and formatting.
  - Unhandled network requests fail the test.
- **CI.** GitHub Actions runs lint, format, typecheck, both suites with coverage thresholds, and the API production build.

## Roadmap

| Phase | Scope                                                                                                                                                                                              | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Foundation: monorepo, contracts, API skeleton (config, logging, correlation IDs, errors, health, DB + migrations + seed), catalog first page, app skeleton (API client, catalog screen), tests, CI | ✅     |
| 2     | Catalog and auth: cursor pagination, category filter, item detail, token auth, entitlement-checked playback endpoint, basic player                                                                 | ✅     |
| 3     | Playback and progress: player with resume, progress tracking across background and interruptions, idempotent writes, multi-device rule                                                             | ⏳     |
| 4     | Offline and observability: persisted catalog cache, offline outbox sync, metrics endpoint, documented cache policy and failure modes                                                               | ⏳     |
| 5     | Optional: rate limiting, contract tests, TV form-factor plan                                                                                                                                       | ⏳     |
