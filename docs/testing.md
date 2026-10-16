# Testing

What each suite covers. The README has the short version.

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
