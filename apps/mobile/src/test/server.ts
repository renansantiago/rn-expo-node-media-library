import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { makeItems } from './fixtures';

export const TEST_API_URL = 'http://api.test';

/** Happy-path handlers; individual tests override with `server.use(...)`. */
export const handlers = [
  http.get(`${TEST_API_URL}/v1/items`, () =>
    HttpResponse.json({ data: makeItems(3), nextCursor: null }),
  ),
];

export const server = setupServer(...handlers);
