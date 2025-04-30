import { defineConfig } from 'tsup';
import { createBasePlugin } from './plugins';

const customNoExternal = new Set([
  "oauth4webapi",
]);

export default function createJsLibraryTsupConfig(options: { barrelFile: boolean }) {
  return defineConfig({
    entryPoints: ['src/**/*.(ts|tsx|js|jsx)'],
    sourcemap: true,
    clean: false,
    noExternal: [...customNoExternal],
    dts: options.barrelFile ? 'src/index.ts' : true,  // we only generate types for the barrel file because it drastically decreases the memory needed for tsup https://github.com/egoist/tsup/issues/920#issuecomment-2454732254
    outDir: 'dist',
    format: ['esm', 'cjs'],
    legacyOutput: true,
    esbuildPlugins: [
      createBasePlugin({}),
      {
        name: 'stackframe: force most files to be external',
        setup(build) {
          build.onResolve({ filter: /^.*$/m }, async (args) => {
            if (args.kind === "entry-point" || customNoExternal.has(args.path)) {
              return undefined;
            }
            return {
              external: true,
            };
          });
        },
      }
    ],
  });
}
