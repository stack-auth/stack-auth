import fs from 'fs';
import path from 'path';
import { defineConfig } from 'tsup';
import { createBasePlugin } from './plugins';


const customNoExternal = new Set([
  "oauth4webapi",
]);

// https://github.com/egoist/tsup/issues/953
const fixImportExtensions = (extension: string = ".js")  => ({
  name: "fix-import-extensions",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer) {
        const filePath = path.join(args.resolveDir, args.path);
        let resolvedPath;

        
        if (fs.existsSync(filePath + ".ts") || fs.existsSync(filePath + ".tsx")) {
          resolvedPath = args.path + extension;
        } else if (fs.existsSync(path.join(filePath, `index.ts`)) || fs.existsSync(path.join(filePath, `index.tsx`))) {
          resolvedPath = args.path.endsWith("/") ? args.path + "index" + extension : args.path + "/index" + extension;
        }
        return { path: resolvedPath ?? args.path, external: true };
      }
    });
  },
});


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
      fixImportExtensions(),
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
