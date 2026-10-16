import { ItemListResponseSchema, ListItemsQuerySchema } from '@media-library/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { CatalogRepository } from './repository';

export const catalogRoutes: FastifyPluginAsyncZod<{ repository: CatalogRepository }> = async (
  app,
  { repository },
) => {
  app.get(
    '/items',
    {
      schema: {
        querystring: ListItemsQuerySchema,
        response: { 200: ItemListResponseSchema },
      },
    },
    async (request) => {
      const data = repository.listItems({ limit: request.query.limit });
      return { data, nextCursor: null };
    },
  );
};
