import * as esbuild from 'esbuild-wasm/lib/browser.js';
import { join } from 'path';
import { StackAssertionError, throwErr } from "./errors";
import { Result } from "./results";
import { isBrowserLike } from './env';

let esbuildInitializePromise: Promise<void> | null = null;
// esbuild requires self property to be set, and it is not set by default in nodejs
(globalThis.self as any) ??= globalThis as any;

export async function initializeEsbuild() {
  if (!esbuildInitializePromise) {
    esbuildInitializePromise = esbuild.initialize(isBrowserLike() ? {
      wasmURL: `https://unpkg.com/esbuild-wasm@${esbuild.version}/esbuild.wasm`,
    } : {
      wasmModule: (
        await fetch(`https://unpkg.com/esbuild-wasm@${esbuild.version}/esbuild.wasm`)
          .then(wasm => wasm.arrayBuffer())
          .then(wasm => new WebAssembly.Module(wasm))
      ),
      worker: false,
    });
  }
  await esbuildInitializePromise;
}

export async function bundleJavaScript(sourceFiles: Record<string, string> & { '/entry.js': string }, options: {
  format?: 'iife' | 'esm' | 'cjs',
  externalPackages?: Record<string, string>,
  keepAsImports?: string[],
  sourcemap?: false | 'inline',
} = {}): Promise<Result<string, string>> {
  await initializeEsbuild();

  const sourceFilesMap = new Map(Object.entries(sourceFiles));
  const externalPackagesMap = new Map(Object.entries(options.externalPackages ?? {}));
  const keepAsImports = options.keepAsImports ?? [];

  const extToLoader: Map<string, esbuild.Loader> = new Map([
    ['tsx', 'tsx'],
    ['ts', 'ts'],
    ['js', 'js'],
    ['jsx', 'jsx'],
    ['json', 'json'],
    ['css', 'css'],
  ]);
  let result;
  try {
    result = await esbuild.build({
      entryPoints: ['/entry.js'],
      bundle: true,
      write: false,
      format: options.format ?? 'iife',
      platform: 'browser',
      target: 'es2015',
      jsx: 'automatic',
      sourcemap: options.sourcemap ?? 'inline',
      external: keepAsImports,
      plugins: [
        {
          name: 'replace-packages-with-globals',
          setup(build) {
            build.onResolve({ filter: /.*/ }, args => {
              // Skip packages that should remain external (not be shimmed)
              if (keepAsImports.includes(args.path)) {
                return undefined;
              }
              if (externalPackagesMap.has(args.path)) {
                return { path: args.path, namespace: 'package-shim' };
              }
              return undefined;
            });

            build.onLoad({ filter: /.*/, namespace: 'package-shim' }, (args) => {
              const contents = externalPackagesMap.get(args.path);
              if (contents == null) throw new StackAssertionError(`esbuild requested file ${args.path} that is not in the virtual file system`);

              return { contents, loader: 'ts' };
            });
          },
        },
        {
          name: 'virtual-fs',
          setup(build) {
            build.onResolve({ filter: /.*/ }, args => {
              const absolutePath = join("/", args.path);
              if (sourceFilesMap.has(absolutePath)) {
                return { path: absolutePath, namespace: 'virtual' };
              }
              return undefined;
            });

            /* 2️⃣  Load the module from the map */
            build.onLoad({ filter: /.*/, namespace: 'virtual' }, args => {
              const contents = sourceFilesMap.get(args.path);
              if (contents == null) throw new StackAssertionError(`esbuild requested file ${args.path} that is not in the virtual file system`);

              const ext = args.path.split('.').pop() ?? '';
              const loader = extToLoader.get(ext) ?? throwErr(`esbuild requested file ${args.path} with unknown extension ${ext}`);

              return { contents, loader };
            });
          },
        },
      ],
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Build failed with ")) {
      return Result.error(e.message);
    }
    throw e;
  }

  if (result.errors.length > 0) {
    return Result.error(result.errors.map(e => e.text).join('\n'));
  }

  if (result.outputFiles.length > 0) {
    return Result.ok(result.outputFiles[0].text);
  }
  return throwErr("No output generated??");
}
