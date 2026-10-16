import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from './helpers';

type Operation = {
  tags?: string[];
  security?: unknown[];
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};
type Document = { paths: Record<string, Record<string, Operation>> };

/** Routes with no JSON body to describe (plain text, HTML UI, or 204). */
const WITHOUT_JSON_RESPONSE = new Set(['GET /metrics', 'POST /v1/auth/logout']);
const PUBLIC_OPERATIONS = new Set([
  'GET /health',
  'GET /ready',
  'GET /metrics',
  'GET /v1/categories',
  'GET /v1/items',
  'GET /v1/items/{id}',
  'POST /v1/auth/login',
]);

describe('OpenAPI document', () => {
  let ctx: TestContext;
  let doc: Document;

  beforeAll(async () => {
    ctx = await createTestApp({ withSeed: false });
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    doc = res.json();
  });
  afterAll(() => ctx.close());

  const operations = () =>
    Object.entries(doc.paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({
        key: `${method.toUpperCase()} ${path}`,
        op,
      })),
    );

  it('matches the committed snapshot (review API changes in apps/api/openapi.json)', async () => {
    // Regenerate after an intentional change with: npm run test -w @media-library/api -- -u
    await expect(`${JSON.stringify(doc, null, 2)}\n`).toMatchFileSnapshot('../openapi.json');
  });

  it('documents every API route', () => {
    const documented = operations().map((o) => o.key);
    const registered = ctx.app.printRoutes({ commonPrefix: false }).split('\n').filter(Boolean);
    expect(registered.length).toBeGreaterThan(0);
    for (const key of [
      'GET /v1/me/progress',
      'PUT /v1/me/progress/{id}',
      'POST /v1/me/progress/batch',
      'GET /v1/items/{id}/playback',
      'GET /v1/me',
    ]) {
      expect(documented).toContain(key);
    }
    expect(documented.filter((key) => key.startsWith('GET /docs'))).toEqual([]);
  });

  it('declares a typed 2xx response for every JSON route (no untyped payloads)', () => {
    const missing = operations()
      .filter(({ key }) => !WITHOUT_JSON_RESPONSE.has(key))
      .filter(({ op }) => {
        const success = Object.entries(op.responses ?? {}).find(([code]) => code.startsWith('2'));
        return !success?.[1].content?.['application/json']?.schema;
      })
      .map(({ key }) => key);
    expect(missing).toEqual([]);
  });

  it('marks every non-public route as requiring a bearer token', () => {
    const unsecured = operations()
      .filter(({ key }) => !PUBLIC_OPERATIONS.has(key))
      .filter(({ op }) => !op.security?.length)
      .map(({ key }) => key);
    expect(unsecured).toEqual([]);
  });

  it('tags every operation for grouping in the docs UI', () => {
    expect(
      operations()
        .filter(({ op }) => !op.tags?.length)
        .map(({ key }) => key),
    ).toEqual([]);
  });

  it('matches the API table in the README, so the docs cannot go stale', () => {
    const readme = readFileSync(new URL('../../../README.md', import.meta.url), 'utf8');
    const documentedInReadme = [...readme.matchAll(/^\| (GET|POST|PUT|DELETE) +\| `([^`]+)`/gm)]
      .map(([, method, path]) => `${method} ${path!.replace(/:(\w+)/g, '{$1}')}`)
      .sort();
    expect(documentedInReadme).toEqual(
      operations()
        .map((o) => o.key)
        .sort(),
    );
  });

  it('serves the interactive docs', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
