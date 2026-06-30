import fs from 'fs';
import path from 'path';
import { defineConfig, type Rolldown } from 'tsdown';
import { createBasePlugin } from './plugins.ts';


const customNoExternal = new Set([
  "oauth4webapi",
]);

// https://github.com/egoist/tsup/issues/953
const fixImportExtensions = (extension: string = ".js"): Rolldown.Plugin => ({
  name: "fix-import-extensions",
  resolveId(source, importer) {
    if (importer == null || !source.startsWith(".")) {
      return null;
    }

    const filePath = path.resolve(path.dirname(importer), source);
    let resolvedPath: string | undefined;

    if (fs.existsSync(`${filePath}.ts`) || fs.existsSync(`${filePath}.tsx`) || fs.existsSync(`${filePath}.js`) || fs.existsSync(`${filePath}.jsx`)) {
      resolvedPath = `${source}${extension}`;
    } else if (
      fs.existsSync(path.join(filePath, 'index.ts')) ||
      fs.existsSync(path.join(filePath, 'index.tsx')) ||
      fs.existsSync(path.join(filePath, 'index.js')) ||
      fs.existsSync(path.join(filePath, 'index.jsx'))
    ) {
      resolvedPath = source.endsWith("/") ? `${source}index${extension}` : `${source}/index${extension}`;
    }

    if (resolvedPath == null) {
      return null;
    }

    return {
      id: resolvedPath,
      external: true,
    };
  },
});


export default function createJsLibraryTsupConfig(_options: { barrelFiles?: string[] | undefined, onSuccess?: string | undefined }) {
  return defineConfig((inlineConfig) => ({
    entry: ['src/**/*.(ts|tsx|js|jsx)'],
    sourcemap: true,
    clean: false,
    deps: {
      alwaysBundle: [...customNoExternal],
      onlyBundle: false,
    },
    // In watch mode, skip DTS and CJS — rolldown 1.1.2 has a concurrency bug
    // (rolldown/tsdown#789) where 6+ watchers in one process stop firing events.
    // TS language server handles types during dev; CJS isn't needed either.
    dts: !inlineConfig.watch,
    onSuccess: inlineConfig.watch ? _options.onSuccess : undefined,
    format: {
      esm: {
        outDir: 'dist/esm',
        outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
      },
      ...(!inlineConfig.watch && {
        cjs: {
          outDir: 'dist',
          outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
        },
      }),
    },
    plugins: [
      fixImportExtensions(),
      createBasePlugin({}),
      {
        name: 'stackframe: force most files to be external',
        resolveId(source: string, importer: string | undefined, options: { isEntry: boolean }) {
          if (options.isEntry || importer == null || customNoExternal.has(source)) {
            return null;
          }

          return {
            id: source,
            external: true,
          };
        },
      }
    ],
  }));
}
