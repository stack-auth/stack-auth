import * as esbuild from 'esbuild-wasm/lib/browser.js';
import { join } from 'path';
import { isBrowserLike } from './env';
import { StackAssertionError, throwErr } from "./errors";
import { Result } from "./results";
import { traceSpan, withTraceSpan } from './telemetry';

const esbuildWasmUrl = `https://unpkg.com/esbuild-wasm@${esbuild.version}/esbuild.wasm`;

let esbuildInitializePromise: Promise<void> | null = null;
// esbuild requires self property to be set, and it is not set by default in nodejs
(globalThis.self as any) ??= globalThis as any;

export function initializeEsbuild(): Promise<void> {
  if (!esbuildInitializePromise) {
    esbuildInitializePromise = withTraceSpan('initializeEsbuild', async () => {
      if (isBrowserLike()) {
        await esbuild.initialize({
          wasmURL: esbuildWasmUrl,
        });
      } else {
        const esbuildWasmResponse = await fetch(esbuildWasmUrl);
        if (!esbuildWasmResponse.ok) {
          throw new StackAssertionError(`Failed to fetch esbuild.wasm: ${esbuildWasmResponse.status} ${esbuildWasmResponse.statusText}: ${await esbuildWasmResponse.text()}`);
        }
        const esbuildWasm = await esbuildWasmResponse.arrayBuffer();
        const esbuildWasmArray = new Uint8Array(esbuildWasm);
        if (esbuildWasmArray[0] !== 0x00 || esbuildWasmArray[1] !== 0x61 || esbuildWasmArray[2] !== 0x73 || esbuildWasmArray[3] !== 0x6d) {
          throw new StackAssertionError(`Invalid esbuild.wasm file: ${new TextDecoder().decode(esbuildWasmArray)}`);
        }
        const esbuildWasmModule = new WebAssembly.Module(esbuildWasm);
        await esbuild.initialize({
          wasmModule: esbuildWasmModule,
          worker: false,
        });
      }
    })();
  }

  return esbuildInitializePromise;
}

export async function bundleJavaScript(sourceFiles: Record<string, string> & { '/entry.js': string }, options: {
  format?: 'iife' | 'esm' | 'cjs',
  externalPackages?: Record<string, string>,
  keepAsImports?: string[],
  sourcemap?: false | 'inline',
  allowHttpImports?: boolean,
} = {}): Promise<Result<string, string>> {
  await initializeEsbuild();

  const sourceFilesMap = new Map(Object.entries(sourceFiles));
  const externalPackagesMap = new Map(Object.entries(options.externalPackages ?? {}));
  const keepAsImports = options.keepAsImports ?? [];

  const httpImportCache = new Map<string, { contents: string, loader: esbuild.Loader, resolveDir: string }>();

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
    result = await traceSpan('bundleJavaScript', async () => await esbuild.build({
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
        ...options.allowHttpImports ? [{
          name: "esm-sh-only",
          setup(build: esbuild.PluginBuild) {
            // Handle absolute URLs and relative imports from esm.sh modules.
            build.onResolve({ filter: /.*/ }, (args) => {
              // Only touch absolute http(s) specifiers or children of our own namespace
              const isHttp = args.path.startsWith("http://") || args.path.startsWith("https://");
              const fromEsmNs = args.namespace === "esm-sh";

              if (!isHttp && !fromEsmNs) return null; // Let other plugins handle bare/relative/local

              // Resolve relative URLs inside esm.sh-fetched modules
              const url = new URL(args.path, fromEsmNs ? args.importer : undefined);

              if (url.protocol !== "https:" || url.host !== "esm.sh") {
                throw new Error(`Blocked non-esm.sh URL import: ${url.href}`);
              }

              return { path: url.href, namespace: "esm-sh" };
            });

            build.onLoad({ filter: /.*/, namespace: "esm-sh" }, async (args) => {
              if (httpImportCache.has(args.path)) return httpImportCache.get(args.path)!;

              const res = await fetch(args.path, { redirect: "follow" });
              if (!res.ok) throw new Error(`Fetch ${res.status} ${res.statusText} for ${args.path}`);
              const finalUrl = new URL(res.url);
              // Defensive: follow shouldn’t leave esm.sh, but re-check.
              if (finalUrl.host !== "esm.sh") {
                throw new Error(`Redirect escaped esm.sh: ${finalUrl.href}`);
              }

              const ct = (res.headers.get("content-type") || "").toLowerCase();
              let loader: esbuild.Loader =
                ct.includes("css") ? "css" :
                ct.includes("json") ? "json" :
                ct.includes("typescript") ? "ts" :
                ct.includes("jsx") ? "jsx" :
                ct.includes("tsx") ? "tsx" :
                  "js";

              // Fallback by extension (esm.sh sometimes omits CT)
              const p = finalUrl.pathname;
              if (p.endsWith(".css")) loader = "css";
              else if (p.endsWith(".json")) loader = "json";
              else if (p.endsWith(".ts")) loader = "ts";
              else if (p.endsWith(".tsx")) loader = "tsx";
              else if (p.endsWith(".jsx")) loader = "jsx";

              const contents = await res.text();
              const result = {
                contents,
                loader,
                // Ensures relative imports inside that module resolve against the file’s URL
                resolveDir: new URL(".", finalUrl.href).toString(),
                watchFiles: [finalUrl.href],
              };
              httpImportCache.set(args.path, result);
              return result;
            });
          },
        } as esbuild.Plugin] : [],
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
    }));
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
