import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanFromEnv.default(false),
  DATABASE_PATH: z.string().min(1).default('./data/media-library.db'),
  /** Lifetime of issued bearer tokens. */
  AUTH_TOKEN_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 7),
  /** Password given to the seeded demo users. When unset, `db:seed` generates and prints one. */
  DEMO_USER_PASSWORD: z.string().min(8).optional(),
  /** Rate-limit window shared by the limits below. */
  RATE_LIMIT_WINDOW_SEC: z.coerce.number().int().min(1).max(3600).default(60),
  /** Login attempts per window, per (client IP, username). */
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).default(10),
  /** Progress writes per window, per user (client IP when unauthenticated). */
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).default(120),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Parses configuration from the environment and fails fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

/** Loads `.env` from the working directory when present (no-op otherwise). */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: rely on the real environment and defaults.
  }
}
