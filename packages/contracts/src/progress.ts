import { z } from 'zod';

/** Progress events stamped further than this ahead of the server clock are rejected. */
export const PROGRESS_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
/** Maximum number of events accepted by one batch request. */
export const PROGRESS_BATCH_MAX = 100;
/** Share of the duration after which a video counts as watched (resume starts over). */
export const PROGRESS_COMPLETION_RATIO = 0.95;

/** Stable, random per-install identifier; also the multi-device tie-break. */
export const DeviceIdSchema = z.string().regex(/^[A-Za-z0-9._-]{8,128}$/, 'Invalid device id');

/**
 * One progress observation produced by a device. `eventId` makes writes idempotent: a retried or
 * replayed event is acknowledged without being applied twice. `recordedAt` is the device clock at
 * the moment the position was observed, which is what the multi-device rule compares.
 */
export const ProgressEventFieldsSchema = z.object({
  eventId: z.uuid(),
  positionSec: z
    .number()
    .nonnegative()
    .max(24 * 60 * 60),
  recordedAt: z.iso.datetime(),
  deviceId: DeviceIdSchema,
});
export type ProgressEventFields = z.infer<typeof ProgressEventFieldsSchema>;

export const ProgressEventSchema = ProgressEventFieldsSchema.extend({ itemId: z.uuid() });
export type ProgressEvent = z.infer<typeof ProgressEventSchema>;

/** Canonical server state for one (user, item). */
export const ProgressSchema = z.object({
  itemId: z.uuid(),
  positionSec: z.number().nonnegative(),
  durationSec: z.number().int().nonnegative(),
  completed: z.boolean(),
  recordedAt: z.iso.datetime(),
  deviceId: DeviceIdSchema,
  updatedAt: z.iso.datetime(),
});
export type Progress = z.infer<typeof ProgressSchema>;

/**
 * - `applied`: the event became the canonical state.
 * - `stale`: a newer observation already won (multi-device rule); the event was recorded but ignored.
 * - `duplicate`: this eventId was already processed (retry/replay); nothing changed.
 */
export const ProgressWriteStatusSchema = z.enum(['applied', 'stale', 'duplicate']);
export type ProgressWriteStatus = z.infer<typeof ProgressWriteStatusSchema>;

export const ProgressRejectReasonSchema = z.enum(['unknown_item', 'forbidden', 'clock_skew']);
export type ProgressRejectReason = z.infer<typeof ProgressRejectReasonSchema>;

export const ProgressWriteResponseSchema = z.object({
  status: ProgressWriteStatusSchema,
  progress: ProgressSchema,
});
export type ProgressWriteResponse = z.infer<typeof ProgressWriteResponseSchema>;

export const ProgressBatchRequestSchema = z.object({
  events: z.array(ProgressEventSchema).min(1).max(PROGRESS_BATCH_MAX),
});
export type ProgressBatchRequest = z.infer<typeof ProgressBatchRequestSchema>;

/**
 * Per-event outcome, in request order. A rejected event is final (retrying cannot succeed), so a
 * single bad event never blocks the rest of a client's outbox.
 */
export const ProgressBatchResultSchema = z.discriminatedUnion('status', [
  z.object({
    eventId: z.uuid(),
    status: ProgressWriteStatusSchema,
    progress: ProgressSchema,
  }),
  z.object({
    eventId: z.uuid(),
    status: z.literal('rejected'),
    reason: ProgressRejectReasonSchema,
  }),
]);
export type ProgressBatchResult = z.infer<typeof ProgressBatchResultSchema>;

export const ProgressBatchResponseSchema = z.object({
  results: z.array(ProgressBatchResultSchema),
});
export type ProgressBatchResponse = z.infer<typeof ProgressBatchResponseSchema>;

export const ListProgressQuerySchema = z.object({
  /** Comma-separated item ids; omitted → the most recently watched items. */
  itemIds: z
    .string()
    .max(100 * 37)
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(100))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListProgressQuery = z.input<typeof ListProgressQuerySchema>;

export const ProgressListResponseSchema = z.object({ data: z.array(ProgressSchema) });
export type ProgressListResponse = z.infer<typeof ProgressListResponseSchema>;

export function isCompleted(positionSec: number, durationSec: number): boolean {
  return durationSec > 0 && positionSec >= durationSec * PROGRESS_COMPLETION_RATIO;
}

/**
 * The multi-device rule, shared by the API and the app's local store: the most recent observation
 * by device clock wins; exact ties go to the lexicographically greater device id, then (when known)
 * the greater event id. That makes it a total order, so every replica converges on the same answer
 * regardless of arrival order, even for a client that reuses timestamps.
 */
export interface Observation {
  recordedAt: string | number;
  deviceId: string;
  eventId?: string;
}

export function isNewerObservation(candidate: Observation, current: Observation): boolean {
  const a =
    typeof candidate.recordedAt === 'number'
      ? candidate.recordedAt
      : Date.parse(candidate.recordedAt);
  const b =
    typeof current.recordedAt === 'number' ? current.recordedAt : Date.parse(current.recordedAt);
  if (a !== b) return a > b;
  if (candidate.deviceId !== current.deviceId) return candidate.deviceId > current.deviceId;
  return (candidate.eventId ?? '') > (current.eventId ?? '');
}
