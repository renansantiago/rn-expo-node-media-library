import {
  canWatch,
  CategoryListResponseSchema,
  ItemListResponseSchema,
  ItemParamsSchema,
  ItemSchema,
  ListItemsQuerySchema,
  PlaybackResponseSchema,
} from '@media-library/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppError } from '../../lib/errors';
import { decodeCursor, encodeCursor } from './cursor';
import type { CatalogRepository } from './repository';

export const catalogRoutes: FastifyPluginAsyncZod<{ repository: CatalogRepository }> = async (
  app,
  { repository },
) => {
  app.get(
    '/categories',
    { schema: { response: { 200: CategoryListResponseSchema } } },
    async () => ({ data: repository.listCategories() }),
  );

  app.get(
    '/items',
    { schema: { querystring: ListItemsQuerySchema, response: { 200: ItemListResponseSchema } } },
    async (request) => {
      const { limit, cursor, category } = request.query;
      const page = repository.listItems({
        limit,
        after: cursor ? decodeCursor(cursor) : undefined,
        categorySlug: category,
      });
      const last = page.items.at(-1);
      return {
        data: page.items,
        nextCursor:
          page.hasMore && last
            ? encodeCursor({ createdAt: Date.parse(last.createdAt), id: last.id })
            : null,
      };
    },
  );

  app.get(
    '/items/:id',
    { schema: { params: ItemParamsSchema, response: { 200: ItemSchema } } },
    async (request) => {
      const found = repository.findItem(request.params.id);
      if (!found) throw new AppError(404, 'NOT_FOUND', 'Item not found');
      return found.item;
    },
  );

  // Who can watch what: the stream URL is only released to authenticated, entitled users.
  app.get(
    '/items/:id/playback',
    {
      preHandler: app.authenticate,
      schema: { params: ItemParamsSchema, response: { 200: PlaybackResponseSchema } },
    },
    async (request, reply) => {
      const found = repository.findItem(request.params.id);
      if (!found) throw new AppError(404, 'NOT_FOUND', 'Item not found');

      const user = request.requireUser();
      if (!canWatch(user.tier, found.requiredTier)) {
        request.log.info({ itemId: found.item.id, userId: user.id }, 'playback denied: tier');
        throw new AppError(403, 'FORBIDDEN', 'Your plan does not include this item');
      }

      reply.header('Cache-Control', 'no-store');
      return { itemId: found.item.id, streamUrl: found.streamUrl };
    },
  );
};
