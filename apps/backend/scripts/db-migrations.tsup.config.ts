import { defineConfig } from 'tsup';
import { createBasePlugin } from '../../../configs/tsup/plugins';
import packageJson from '../package.json';

const customNoExternal = new Set([
  ...Object.keys(packageJson.dependencies),
]);

// tsup config to build the self-hosting migration script so it can be
// run in the Docker container with no extra dependencies.
export default defineConfig({
  entry: ['scripts/db-migrations.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node22',
  platform: 'node',
  noExternal: [...customNoExternal],
  clean: true,
  esbuildPlugins: [
    createBasePlugin({}),
  ],
});
