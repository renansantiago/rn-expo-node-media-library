import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSec: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadyResponseSchema = z.object({
  status: z.literal('ready'),
  checks: z.record(z.string(), z.literal('ok')),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
