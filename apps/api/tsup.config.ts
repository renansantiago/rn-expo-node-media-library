import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/db/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Bundle the workspace contracts package (it ships TypeScript source); keep real deps external.
  noExternal: ['@media-library/contracts'],
});
