import { createHash, randomBytes } from 'node:crypto';

/** 256-bit opaque bearer token. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('base64url');
