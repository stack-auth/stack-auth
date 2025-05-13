import fs from 'fs';
import path from 'path';
import { defineConfig, Options } from 'tsup';


// https://github.com/egoist/tsup/issues/953
const fixImportExtensions = (extension: string = ".js")  => ({
  name: "fix-import-extensions",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer) {
        const filePathWithExtension = path.join(args.resolveDir, args.path) + ".ts";
        let resolvedPath;
        
        if (fs.existsSync(filePathWithExtension + ".ts")) {
          resolvedPath = args.path + extension;
        } 
        else if (fs.existsSync(filePathWithExtension + ".tsx")) {
          resolvedPath = args.path + extension;
        }
        else if (path.join(args.resolveDir, args.path, `index.ts`)) {
          resolvedPath = args.path.endsWith("/") ? args.path + "index" + extension : args.path + "/index" + extension;

        }
        else if (path.join(args.resolveDir, args.path, `index.tsx`)) {
          resolvedPath = args.path.endsWith("/") ? args.path + "index" + extension : args.path + "/index" + extension;
        }
        return { path: resolvedPath ?? args.path, external: true };
      }
    });
  },
});


const commonOptions: Options = {
  entryPoints: ['src/**/*.(ts|tsx|js|jsx)'],
  sourcemap: true,
  clean: false,
  dts: 'src/index.ts',  // we only generate types for the barrel file because it drastically decreases the memory needed for tsup https://github.com/egoist/tsup/issues/920#issuecomment-2454732254
  outDir: 'dist',
  legacyOutput: true,
}

const config: Options[] = [
  {
    ...commonOptions,
    format: ['esm'],
    esbuildPlugins: [
      fixImportExtensions(),
    ],
  },
  {
    ...commonOptions,
    format: ['cjs'],
    esbuildPlugins: [
    ],
  },
]

export default defineConfig(config);
