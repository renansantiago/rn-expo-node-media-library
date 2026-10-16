# ADR 0003: Playback progress, idempotent writes and the multi-device rule

- **Status:** accepted
- **Context:** Progress must survive backgrounding, interruptions and app kills, stay correct when writes are retried, keep working offline, and resolve predictably when the same user watches on several devices.

## Decision

- **Multi-device rule: last observation wins.** Each progress event carries the device clock time it was observed at (`recordedAt`) and a stable per-install `deviceId`.
  - The canonical position is the most recent observation, not the most recent arrival. A phone that watched offline at 9:00 and syncs at 10:00 does not overwrite a tablet that watched at 9:30.
  - Exact timestamp ties go to the greater `deviceId`, so every replica (API and each device's local store) converges on the same answer whatever the delivery order.
  - The rule lives in `packages/contracts` (`isNewerObservation`). The API runs it as a single SQL upsert (`ON CONFLICT … DO UPDATE … WHERE`), which is atomic even with several writers. The app's local store applies the same SQL when it merges server state.
  - Moving backwards is allowed when it is newer: if the user rewinds, the rewind wins.
  - Alternatives rejected: _furthest position wins_ (can never rewind, and a stray seek to the end sticks forever); _server arrival time wins_ (late offline syncs clobber newer progress).
- **Idempotency by event id.** Every event has a client-generated UUID. `progress_events` is keyed by `(user_id, event_id)`. A replayed or retried event is answered with `duplicate` and the current state, without being re-applied. Every write response returns the canonical state, so the client can reconcile immediately.
- **Guards.**
  - A `recordedAt` more than 5 minutes ahead of the server clock is rejected (`422 CLOCK_SKEW`, or `rejected/clock_skew` in a batch). Otherwise a device with a wrong clock would win every future comparison.
  - Positions are clamped to `[0, duration]`, and the item must exist and be covered by the user's plan.
- **Batch endpoint for sync.** `POST /v1/me/progress/batch` (1–100 events) resolves each event independently and reports `applied`, `stale`, `duplicate` or `rejected` with a reason. Rejections are final (retrying cannot succeed), so one bad event never blocks a device's outbox.
- **App: local first, then an outbox.**
  - Every save goes to an on-device SQLite database (`expo-sqlite`, migrated with `PRAGMA user_version`) and into an outbox in the same transaction. The player resumes from local state, so resume works offline and right after a crash.
  - The outbox keeps one pending event per (user, item); a newer save replaces the queued one. Events are removed only once the server resolves them (or rejects them as permanently invalid). Transport failures reschedule them with capped, jittered exponential backoff (2s → 5 min), and a timer retries.
  - The sync engine is single-flight and flushes after each save (when online), on launch and sign-in, when the app returns to the foreground, and when NetInfo reports that connectivity is back. Those last three skip any pending retry backoff, since the reason for backing off is gone.
  - Local timestamps are strictly increasing per item for the device, so a clock that moves backwards never makes a device lose to its own older save.
- **When to save** (`useProgressTracker`): every 10 s while playing, on pause, after a seek, at the end of the video, when the app leaves the foreground (the OS may kill it next), and when the player unmounts. Saves under 1 s apart are skipped. Time updates are ignored until the resume seek has landed, so the pre-seek position (usually 0) can never overwrite real progress.
- **Resume rule:** start over when there is no progress, under 5 s, or at least 95% watched; otherwise resume at the saved position. Before starting, the player pulls the server's state for the item (3 s timeout) so a newer position from another device wins, then falls back to local state.

## Consequences

- The rule depends on device clocks being roughly right. The skew guard bounds the damage from a clock that runs ahead. A clock that runs slow makes that device's saves lose to other devices until it is corrected, which degrades to "another device's position is kept".
- Signed-out users have no progress (it is per account). Progress saved before a sign-out stays queued under that user and is delivered the next time they sign in on the device.
- `progress_events` grows with every distinct event. Production would prune it by `received_at` (already indexed) after a retention window, or move the audit trail to a log pipeline.
- On a single SQLite file, writes are serialised anyway. Moving to Postgres keeps the same upsert (`ON CONFLICT … DO UPDATE … WHERE`) with the same guarantees.
