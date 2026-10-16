# Media Library

A small media library product with two parts. The **mobile app** (Expo / React Native, iOS and Android) browses a catalog of videos, plays them, and keeps working offline. The **API** (Node.js / Fastify / SQLite) serves the catalog, enforces who can watch what, and stores playback progress.

The focus is correctness, reliability and operational quality, not visual design.

> **Status:** Phase 1 is done: the foundation and a working end-to-end slice. See [Roadmap](#roadmap) for what comes next.

---

## Repository layout

```
apps/
  api/                 Fastify API (TypeScript, SQLite + Drizzle)
    src/
      app.ts           buildApp() factory, shared by the server and the tests
      server.ts        process entry: config, migrations, listen, graceful shutdown
      config.ts        environment parsed and validated with zod (fail fast)
      plugins/         correlation-id, error-handler
      modules/         feature modules (health, catalog, …): routes + repository
      db/              schema, client, migrator, seed, maintenance CLI
    drizzle/           generated SQL migrations (committed)
    test/              integration tests (in-memory SQLite per test)
  mobile/              Expo app (TypeScript, Expo Router)
    src/
      app/             routes (screens) only
      features/        feature code (catalog, …): data hooks + components
      lib/             api client, logger, config, formatting, error mapping
      providers/       app-wide providers (query client, api client)
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
npm install          # installs every workspace
npm run db:reset     # creates the SQLite DB, applies migrations, seeds the demo catalog
npm run dev:api      # API on http://localhost:3000 (auto-reloads)
```

In a second terminal:

```bash
npm run dev:mobile   # starts Expo; press i (iOS), a (Android) or scan the QR code with Expo Go
```

The app finds the API automatically. It uses port 3000 on the machine running the Expo dev server, which works for simulators, emulators and devices on the same LAN. To point it somewhere else, copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_API_URL`.

Check the API by hand:

```bash
curl localhost:3000/health
curl -i -H 'X-Correlation-Id: demo-12345678' 'localhost:3000/v1/items?limit=2'
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

| Variable        | Default                   | Notes                                                        |
| --------------- | ------------------------- | ------------------------------------------------------------ |
| `PORT` / `HOST` | `3000` / `0.0.0.0`        | Listens on all interfaces so devices on the LAN can reach it |
| `LOG_LEVEL`     | `info`                    | pino level (`silent` in tests)                               |
| `LOG_PRETTY`    | `false`                   | Human-readable logs for local development                    |
| `DATABASE_PATH` | `./data/media-library.db` | SQLite file (git-ignored)                                    |

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
- **Liveness vs readiness.** `/health` reports that the process is up. `/ready` checks the database and returns 503 when it is unavailable.

## API (current)

| Method | Path        | Auth | Description                                                                         |
| ------ | ----------- | ---- | ----------------------------------------------------------------------------------- |
| GET    | `/health`   | –    | Liveness                                                                            |
| GET    | `/ready`    | –    | Readiness (database check)                                                          |
| GET    | `/v1/items` | –    | Catalog, newest first. `limit` is 1–50 (default 20). Returns `{ data, nextCursor }` |

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

| Table        | Columns                                                                                                                                                   | Notes                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `categories` | `id` PK, `slug` unique, `name`                                                                                                                            |                                                                                                                 |
| `items`      | `id` PK (uuid), `title`, `description`, `category_id` FK, `duration_sec`, `thumbnail_url`, `stream_url`, `required_tier` (`free`/`premium`), `created_at` | Indexed on `(created_at, id)` and `(category_id, created_at, id)` for keyset pagination and the category filter |

Migrations live in `apps/api/drizzle/`. They are generated from `src/db/schema.ts` with `npm run db:generate -w @media-library/api` and applied automatically on server start (or with `db:migrate`). The seed uses publicly hosted sample HLS/MP4 streams, and several items share a stream on purpose. Item IDs are stable across resets.

## Testing

```bash
npm test                                           # everything
npm run test:coverage -w @media-library/api        # API with coverage thresholds
npm run test:coverage -w @media-library/mobile     # app with coverage thresholds
```

- **API (Vitest).** Integration tests drive the real app through `app.inject()`, each against a fresh, migrated in-memory SQLite database. They cover health and readiness (including DB failure), the catalog contract, input validation, the error envelope, correlation-ID propagation, and not leaking internals.
- **Mobile (Jest + jest-expo + React Native Testing Library + MSW).**
  - Screen tests render real providers with the real API client against MSW, covering the success, empty, server error with retry, timeout, offline and contract-violation states.
  - Unit tests cover the API client (timeouts, cancellation, error mapping, header propagation), the retry policy, the logger, config resolution and formatting.
  - Unhandled network requests fail the test.
- **CI.** GitHub Actions runs lint, format, typecheck, both suites with coverage thresholds, and the API production build.

## Roadmap

| Phase | Scope                                                                                                                                                                                              | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Foundation: monorepo, contracts, API skeleton (config, logging, correlation IDs, errors, health, DB + migrations + seed), catalog first page, app skeleton (API client, catalog screen), tests, CI | ✅     |
| 2     | Catalog and auth: cursor pagination, category filter, item detail, token auth, entitlement-checked playback endpoint                                                                               | ⏳     |
| 3     | Playback and progress: player with resume, progress tracking across background and interruptions, idempotent writes, multi-device rule                                                             | ⏳     |
| 4     | Offline and observability: persisted catalog cache, offline outbox sync, metrics endpoint, documented cache policy and failure modes                                                               | ⏳     |
| 5     | Optional: rate limiting, contract tests, TV form-factor plan                                                                                                                                       | ⏳     |
