import { builtinModules } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Rolldown, type UserConfig } from 'tsdown';
import { createBasePlugin } from '../../../configs/tsdown/plugins.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');

const packageJson = JSON.parse(readFileSync(resolve(backendDir, 'package.json'), 'utf-8'));

const customNoExternal = new Set([
  ...Object.keys(packageJson.dependencies),
]);

// Node.js built-in modules that should not be bundled
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

const basePlugin: Rolldown.Plugin = createBasePlugin({});

export default defineConfig({
  entry: [resolve(backendDir, 'scripts/db-migrations.ts')],
  format: ['esm'],
  outDir: resolve(backendDir, 'dist'),
  target: 'node22',
  platform: 'node',
  noExternal: [...customNoExternal],
  inlineOnly: false,
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
  plugins: [basePlugin],
} satisfies UserConfig);
