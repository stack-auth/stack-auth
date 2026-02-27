import { builtinModules } from 'node:module';
import { defineConfig, type Options } from 'tsdown';
import { createBasePlugin } from '../../../configs/tsdown/plugins';
import packageJson from '../package.json';

const customNoExternal = new Set([
  ...Object.keys(packageJson.dependencies),
]);

// Node.js built-in modules that should not be bundled
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

// tsdown config to build the self-hosting migration script so it can be
// run in the Docker container with no extra dependencies.
type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];
const basePlugin = createBasePlugin({}) as unknown as EsbuildPlugin;

export default defineConfig({
  entry: ['scripts/db-migrations.ts'],
  format: ['esm'],
  outDir: 'dist',
  target: 'node22',
  platform: 'node',
  noExternal: [...customNoExternal],
  // Externalize Node.js builtins so they're imported rather than shimmed
  external: nodeBuiltins,
  clean: true,
  // Use banner to add createRequire for CommonJS modules that use require() for builtins
  // The imported require is used by the shimmed __require2 function
  banner: {
    js: `import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
const require = __createRequire(import.meta.url);`,
  },
  // Cast to tsdown's esbuild plugin type to avoid esbuild version mismatch in typecheck.
  esbuildPlugins: [basePlugin],
} satisfies Options);
