import fs from 'fs';
import path from 'path';
import { defineConfig, type NormalizedFormat, type Rolldown } from 'tsdown';
import { createBasePlugin } from './plugins.ts';


const customNoExternal = new Set([
  "oauth4webapi",
]);

type PackageJsonValue = string | PackageJsonValue[] | { [key: string]: PackageJsonValue };

const rewriteEsmExportTarget = (target: string): string | undefined => {
  if (target.startsWith("./dist/esm/")) {
    return `./${target.slice("./dist/esm/".length)}`;
  }

  if (target.startsWith("./dist/")) {
    return `./${target.slice("./dist/".length)}`;
  }

  return undefined;
};

const createEsmExports = (value: unknown): PackageJsonValue | undefined => {
  if (typeof value === "string") {
    return rewriteEsmExportTarget(value);
  }

  if (Array.isArray(value)) {
    const rewrittenValues: PackageJsonValue[] = [];
    for (const item of value) {
      const rewrittenItem = createEsmExports(item);
      if (rewrittenItem != null) {
        rewrittenValues.push(rewrittenItem);
      }
    }

    return rewrittenValues.length > 0 ? rewrittenValues : undefined;
  }

  if (value == null || typeof value !== "object") {
    return undefined;
  }

  const rewrittenEntries: Array<[string, PackageJsonValue]> = [];
  for (const [key, item] of Object.entries(value)) {
    if (key === "require") {
      continue;
    }

    const rewrittenItem = createEsmExports(item);
    if (rewrittenItem != null) {
      rewrittenEntries.push([key, rewrittenItem]);
    }
  }

  return rewrittenEntries.length > 0
    ? Object.fromEntries(rewrittenEntries)
    : undefined;
};

const findPackageRootFromSource = (sourcePath: string): string => {
  let currentPath = path.dirname(path.resolve(sourcePath));
  while (true) {
    if (fs.existsSync(path.join(currentPath, 'package.json'))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }

  throw new Error(`Could not find a package.json for ESM source path ${sourcePath}`);
};

const findPackageRoot = (bundle: Rolldown.OutputBundle): string => {
  let fallbackSourcePath: string | undefined;

  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk' || !output.isEntry) {
      continue;
    }

    if (output.facadeModuleId != null && !output.facadeModuleId.startsWith('\0')) {
      return findPackageRootFromSource(output.facadeModuleId);
    }

    fallbackSourcePath = output.moduleIds.find((moduleId) => !moduleId.startsWith('\0'));
    if (fallbackSourcePath != null) {
      return findPackageRootFromSource(fallbackSourcePath);
    }
  }

  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') {
      continue;
    }

    fallbackSourcePath ??= output.moduleIds.find((moduleId) => !moduleId.startsWith('\0'));
    if (fallbackSourcePath != null) {
      return findPackageRootFromSource(fallbackSourcePath);
    }
  }

  throw new Error('Could not determine the package source path from the ESM output bundle');
};

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


export default function createJsLibraryTsupConfig(_options: { barrelFiles?: string[] | undefined, onSuccess?: string | ((...args: unknown[]) => void) | undefined }) {
  return defineConfig((inlineConfig) => ({
    entry: ['src/**/*.(ts|tsx|js|jsx)'],
    sourcemap: true,
    clean: false,
    deps: {
      alwaysBundle: [...customNoExternal],
      onlyBundle: false,
    },
    // In watch mode, DTS and CJS are disabled to keep the rolldown watcher count
    // at 11 (one per package). The DTS plugin doubles the watcher count, and
    // dual format (ESM+CJS) doubles it again — either of which pushes us past
    // rolldown's concurrency limit, causing a deadlock in rolldown 1.1.2
    // (rolldown/tsdown#789, rolldown/rolldown#8643).
    // TypeScript's language server provides type checking during dev anyway,
    // and CJS dist isn't needed during development.
    dts: inlineConfig.watch ? false : true,
    onSuccess: _options.onSuccess,
    // Some source files use `import.meta` inside platform-specific branches (e.g.
    // `import.meta.env?.SSR` for the TanStack Start build in src/lib/cookie.ts).
    // `import.meta` isn't valid in CJS, so rolldown emits an [EMPTY_IMPORT_META]
    // warning for it once per package during the dual-format build, spamming the
    // dev output. Only the ESM build is ever loaded by the runtimes that read
    // `import.meta`; the CJS build's auto-replacement of `import.meta` with `{}`
    // is exactly the behaviour we want, so silence just that warning for CJS.
    inputOptions: (options: Rolldown.InputOptions, format: NormalizedFormat) => {
      if (format !== 'cjs') {
        return options;
      }
      const previousOnLog = options.onLog;
      options.onLog = (level, log, defaultHandler) => {
        if (log.code === 'EMPTY_IMPORT_META') {
          return;
        }
        if (previousOnLog != null) {
          previousOnLog(level, log, defaultHandler);
        } else {
          defaultHandler(level, log);
        }
      };
      return options;
    },
    ...(inlineConfig.watch ? {
      format: 'esm',
      outDir: 'dist/esm',
      outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    } : {
      format: {
        esm: {
          outDir: 'dist/esm',
          outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
        },
        cjs: {
          outDir: 'dist',
          outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
        },
      },
    }),
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
      },
      {
        name: 'stackframe: mark esm output as modules',
        writeBundle(outputOptions, bundle) {
          if (outputOptions.dir == null || path.basename(outputOptions.dir) !== 'esm') {
            return;
          }

          const packageRoot = findPackageRoot(bundle);
          const esmOutputDir = path.resolve(packageRoot, outputOptions.dir);
          const packageJsonPath = path.join(packageRoot, 'package.json');
          const packageJson: {
            name?: string;
            exports?: unknown;
          } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

          // Strict runtimes like tsx parse ESM output as CJS without this marker.
          // Preserve self-referencing exports because this file becomes a nested package scope.
          fs.mkdirSync(esmOutputDir, { recursive: true });
          fs.writeFileSync(
            path.join(esmOutputDir, 'package.json'),
            `${JSON.stringify({
              name: packageJson.name,
              type: 'module',
              exports: createEsmExports(packageJson.exports),
            }, null, 2)}\n`,
          );
        },
      },
    ],
  }));
}
