import { z } from 'zod';
import { AppError } from '../../lib/errors';

/** Position of the last item of a page in the (created_at DESC, id DESC) ordering. */
export interface CatalogCursor {
  createdAt: number;
  id: string;
}

const CursorSchema = z.object({ t: z.number().int().nonnegative(), id: z.string().min(1) });

/** Cursors are opaque to clients (base64url JSON) so the ordering can change without breaking them. */
export function encodeCursor({ createdAt, id }: CatalogCursor): string {
  return Buffer.from(JSON.stringify({ t: createdAt, id })).toString('base64url');
}

export function decodeCursor(cursor: string): CatalogCursor {
  try {
    const parsed = CursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { createdAt: parsed.t, id: parsed.id };
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor');
  }
}
