import type { ManagedOtelOptions, ManagedOtelRegistration } from "./otel-managed";

type OtelSdkModule = {
  registerManagedOtel: (options: ManagedOtelOptions) => ManagedOtelRegistration,
};

type OtelSdkLoadAttempt =
  | { module: OtelSdkModule }
  | { module: null, errors: unknown[] };

/**
 * Loads the Node-only managed OTel SDK without a static import edge.
 *
 * `server-app-impl` is reachable from the client package barrel (StackProvider
 * types StackServerApp). A static `import "./otel-sdk"` would drag
 * `async_hooks` / Undici into browser and client-SSR bundles. Keep the
 * specifier opaque (non-literal + ignore pragmas) so bundlers cannot follow it;
 * browsers simply fail the import and degrade to "no managed Node provider".
 *
 * Two resolution strategies, in order:
 * 1. The relative sibling (`./otel-sdk[.js]`) — works when this file runs from
 *    its real dist location (external apps, Vitest TS sources).
 * 2. Bare `<package>/otel` specifiers — when a bundler (e.g. Next.js/Turbopack,
 *    which force-bundles workspace dependencies into server chunks) has copied
 *    this code into a chunk, `import.meta.url` points at the chunk and the
 *    relative sibling no longer exists. A bare package specifier instead
 *    resolves through node_modules from wherever the chunk lives; the `/otel`
 *    subpath re-exports `registerManagedOtel` precisely for this. The bundled
 *    copy cannot know which SDK package it came from, so every package name
 *    that ships this file is tried and absent ones are skipped.
 */
function otelSdkSpecifiers(): string[] {
  const base = ["otel", "sdk"].join("-");
  // `.js` for Node ESM dist; extensionless for Vitest/Vite TS resolution.
  const relative = [`./${base}.js`, `./${base}`];
  // Assembled at runtime so bundlers cannot statically follow the specifiers.
  const packageQualified = ["next", "react", "js", "template"]
    .map((name) => ["@hexclave/", name, "/otel"].join(""));
  return [...relative, ...packageQualified];
}

function describeLoadError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isOtelSdkModule(value: unknown): value is OtelSdkModule {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "registerManagedOtel") === "function";
}

function isCreateRequire(value: unknown): value is (url: string | URL) => (id: string) => unknown {
  return typeof value === "function";
}

/**
 * Sync path for Node: `process.getBuiltinModule("module").createRequire` loads
 * the sibling CJS build without a static import graph. Returns null outside
 * Node, when createRequire cannot load ESM-only siblings, or under Vitest's
 * TypeScript source layout.
 */
function tryRequireOtelSdkSyncAttempt(): OtelSdkLoadAttempt {
  const errors: unknown[] = [];
  try {
    // Read `process` untyped: the ambient Node types claim it always exists,
    // but this guard is exactly for non-Node runtimes where it doesn't.
    const proc: unknown = Reflect.get(globalThis, "process");
    if (proc == null || typeof proc !== "object") return { module: null, errors };
    const getBuiltinModule = Reflect.get(proc, "getBuiltinModule");
    if (typeof getBuiltinModule !== "function") return { module: null, errors };
    const nodeModule = getBuiltinModule.call(proc, "module");
    if (nodeModule == null || typeof nodeModule !== "object") return { module: null, errors };
    const createRequire = Reflect.get(nodeModule, "createRequire");
    if (!isCreateRequire(createRequire)) return { module: null, errors };

    const urls = [import.meta.url];
    // dist/esm/... → dist/... CJS twin, which createRequire can load.
    if (import.meta.url.includes("/dist/esm/")) {
      urls.push(import.meta.url.replace("/dist/esm/", "/dist/"));
    }

    for (const url of urls) {
      const require = createRequire.call(nodeModule, url);
      for (const id of otelSdkSpecifiers()) {
        try {
          const mod = require(id);
          if (isOtelSdkModule(mod)) return { module: mod };
          errors.push(new Error(`${id} loaded but is missing registerManagedOtel`));
        } catch (error) {
          errors.push(error);
        }
      }
    }
    return { module: null, errors };
  } catch (error) {
    errors.push(error);
    return { module: null, errors };
  }
}

export function tryRequireOtelSdkSync(): OtelSdkModule | null {
  return tryRequireOtelSdkSyncAttempt().module;
}

let otelSdkImportPromise: Promise<OtelSdkLoadAttempt> | null = null;

function importOtelSdkAttempt(): Promise<OtelSdkLoadAttempt> {
  if (otelSdkImportPromise === null) {
    otelSdkImportPromise = (async (): Promise<OtelSdkLoadAttempt> => {
      const errors: unknown[] = [];
      for (const specifier of otelSdkSpecifiers()) {
        try {
          const mod: unknown = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier);
          if (isOtelSdkModule(mod)) return { module: mod };
          errors.push(new Error(`${specifier} loaded but is missing registerManagedOtel`));
        } catch (error) {
          errors.push(error);
        }
      }
      return { module: null, errors };
    })();
  }
  return otelSdkImportPromise;
}

/** Async load; works for ESM dist and Vitest source resolution. */
export function importOtelSdk(): Promise<OtelSdkModule | null> {
  return importOtelSdkAttempt().then((result) => result.module);
}

export async function registerManagedOtelAsync(options: ManagedOtelOptions): Promise<ManagedOtelRegistration> {
  const sync = tryRequireOtelSdkSyncAttempt();
  if (sync.module !== null) return sync.module.registerManagedOtel(options);
  const loaded = await importOtelSdkAttempt();
  if (loaded.module !== null) return loaded.module.registerManagedOtel(options);
  const details = [...sync.errors, ...loaded.errors].map(describeLoadError).filter((message) => message !== "");
  throw new Error(
    details.length === 0
      ? "Hexclave managed OpenTelemetry requires a Node.js runtime; the Node OTel SDK could not be loaded"
      : `Hexclave managed OpenTelemetry requires a Node.js runtime; the Node OTel SDK could not be loaded: ${details.join("; ")}`,
  );
}
