# ADR 0001: Monorepo and technology stack

- **Status:** accepted
- **Context:** The product is a mobile app plus the API it depends on. Reviewers must be able to clone, install and run both with minimal setup. The app and the API share a contract (request and response shapes) that must not drift.

## Decision

| Concern         | Choice                                                        | Why                                                                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository      | One repo, npm workspaces (`apps/*`, `packages/*`)             | A single clone and a single install. Expo supports npm workspaces natively. No extra tooling such as pnpm, Turborepo or Nx.                                                                                                                                                                |
| Shared contract | `packages/contracts`: zod schemas plus inferred TS types      | One source of truth. The API validates requests and serialises responses with these schemas, and the app validates every response at runtime with the same schemas. It ships TS source, so there is no build step.                                                                         |
| API framework   | Fastify 5                                                     | Built-in pino structured logging, request-ID hooks (used for correlation IDs), schema-driven validation through `fastify-type-provider-zod`, and `app.inject()` for fast in-process tests. Next.js is built for UI and serverless, and bare `node:http` would mean rebuilding all of this. |
| Datastore       | SQLite (`better-sqlite3`) with Drizzle ORM and SQL migrations | Nothing to install or run. It gives real SQL with transactions and `ON CONFLICT` upserts (needed for idempotent progress writes). Migrations are generated, committed, and applied on boot. Postgres is the production path; the Drizzle schema ports with dialect changes.                |
| Mobile          | Expo (managed, CNG) with TypeScript and Expo Router           | Runs in Expo Go for reviewers, gives file-based routing, and builds for iOS and Android from one codebase.                                                                                                                                                                                 |
| Server state    | TanStack Query                                                | Caching, retries with backoff, request cancellation, and later cache persistence for offline use.                                                                                                                                                                                          |
| Tests           | Vitest (API), Jest + jest-expo + RNTL + MSW (app)             | API tests run against a fresh in-memory SQLite per test. App tests exercise the real API client over a mocked network (MSW), with no hand-rolled fetch mocks in screen tests.                                                                                                              |

## Consequences

- SQLite allows a single writer. That is fine for this scope (WAL mode, `busy_timeout`); a horizontally scaled API would need Postgres.
- The app must keep React at exactly the version React Native expects. The root `overrides` pin `react` and `react-dom` so npm cannot hoist a second copy.
- `jest`/`@types/jest` are excluded from Expo's dependency check because `jest-expo@58` is built on Jest 30, while the SDK's version table still lists Jest 29.
