import { isNewerObservation } from '@media-library/contracts';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, type DbHandle } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { categories, items, users } from '../src/db/schema';
import { createProgressRepository } from '../src/modules/progress/repository';

const ITEM = '00000000-0000-4000-8000-000000000001';
const T0 = Date.parse('2026-06-01T12:00:00.000Z');

/** Small value ranges on purpose: they make timestamp ties and replays frequent. */
const eventArb = fc.record({
  eventId: fc.uuid(),
  positionSec: fc.integer({ min: 0, max: 600 }),
  recordedAtOffsetSec: fc.integer({ min: 0, max: 5 }),
  deviceId: fc.constantFrom('device-a', 'device-b', 'device-c'),
});
type Event = typeof eventArb extends fc.Arbitrary<infer T> ? T : never;

/** Events, the same events in a random order, plus random replays of some of them. */
// Event ids are unique per event (a fresh UUID each); reusing one is a replay, covered by `replays`.
const scenarioArb = fc
  .uniqueArray(eventArb, { minLength: 1, maxLength: 12, selector: (e) => e.eventId })
  .chain((events) =>
    fc.record({
      events: fc.constant(events),
      shuffled: fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }),
      replays: fc.subarray(events),
    }),
  );

const recordedAt = (event: Event) => T0 + event.recordedAtOffsetSec * 1000;

describe('multi-device rule (property-based)', () => {
  let handle: DbHandle;
  let repository: ReturnType<typeof createProgressRepository>;
  let run = 0;

  beforeAll(() => {
    handle = openDatabase(':memory:');
    runMigrations(handle.db);
    handle.db.insert(categories).values({ id: 'cat', slug: 'cat', name: 'Cat' }).run();
    handle.db
      .insert(items)
      .values({
        id: ITEM,
        title: 'Item',
        description: '',
        categoryId: 'cat',
        durationSec: 600,
        streamUrl: 'https://example.test/a.m3u8',
        createdAt: new Date(T0),
      })
      .run();
    repository = createProgressRepository(handle.db);
  });
  afterAll(() => handle.close());

  /** Applies events for a brand-new user and returns the final canonical state. */
  function apply(events: Event[]) {
    const userId = `user-${run++}`;
    handle.db
      .insert(users)
      .values({
        id: userId,
        username: userId,
        displayName: userId,
        tier: 'free',
        passwordHash: 'x',
        createdAt: new Date(T0),
      })
      .run();
    let last;
    for (const event of events) {
      last = repository.recordEvent({
        userId,
        itemId: ITEM,
        eventId: event.eventId,
        positionSec: event.positionSec,
        recordedAt: new Date(recordedAt(event)),
        deviceId: event.deviceId,
        receivedAt: new Date(T0),
      }).progress;
    }
    return last!;
  }

  it('converges on the same state whatever the delivery order, retries or replays', () => {
    fc.assert(
      fc.property(scenarioArb, ({ events, shuffled, replays }) => {
        const inOrder = apply(events);
        const reordered = apply([...shuffled, ...replays]);

        // The expected winner, computed independently with the shared rule.
        const winner = events.reduce((best, candidate) =>
          isNewerObservation(
            { recordedAt: recordedAt(candidate), ...candidate },
            { recordedAt: recordedAt(best), ...best },
          )
            ? candidate
            : best,
        );
        const expected = {
          positionSec: winner.positionSec,
          deviceId: winner.deviceId,
          recordedAt: new Date(recordedAt(winner)).toISOString(),
        };
        expect(inOrder).toMatchObject(expected);
        expect(reordered).toMatchObject(expected);
      }),
      { numRuns: 200 },
    );
  });

  it('the rule is a strict total order: irreflexive, asymmetric, transitive and total', () => {
    const observation = fc.record({
      recordedAt: fc.integer({ min: 0, max: 3 }),
      deviceId: fc.constantFrom('a', 'b', 'c'),
      eventId: fc.constantFrom('e1', 'e2', 'e3'),
    });
    fc.assert(
      fc.property(observation, observation, observation, (a, b, c) => {
        expect(isNewerObservation(a, a)).toBe(false);
        // Total: two distinct observations are always ordered one way or the other.
        const same =
          a.recordedAt === b.recordedAt && a.deviceId === b.deviceId && a.eventId === b.eventId;
        if (!same) expect(isNewerObservation(a, b) || isNewerObservation(b, a)).toBe(true);
        if (isNewerObservation(a, b)) expect(isNewerObservation(b, a)).toBe(false);
        if (isNewerObservation(a, b) && isNewerObservation(b, c)) {
          expect(isNewerObservation(a, c)).toBe(true);
        }
      }),
      { numRuns: 500 },
    );
  });
});
