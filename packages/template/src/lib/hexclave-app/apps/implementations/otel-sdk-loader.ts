import type { ManagedOtelOptions, ManagedOtelRegistration } from "./otel-managed";

type OtelSdkModule = {
  registerManagedOtel: (options: ManagedOtelOptions) => ManagedOtelRegistration,
};

/**
 * Loads the Node-only managed OTel SDK without a static import edge.
 *
 * `server-app-impl` is reachable from the client package barrel (StackProvider
 * types StackServerApp). A static `import "./otel-sdk"` would drag
 * `async_hooks` / Undici into browser and client-SSR bundles. Keep the
 * specifier opaque (non-literal + ignore pragmas) so bundlers cannot follow it;
 * browsers simply fail the import and degrade to "no managed Node provider".
 */
function otelSdkSpecifiers(): string[] {
  const base = ["otel", "sdk"].join("-");
  // `.js` for Node ESM dist; extensionless for Vitest/Vite TS resolution.
  return [`./${base}.js`, `./${base}`];
}

/**
 * Sync path for Node: `process.getBuiltinModule("module").createRequire` loads
 * the sibling CJS build without a static import graph. Returns null outside
 * Node, when createRequire cannot load ESM-only siblings, or under Vitest's
 * TypeScript source layout.
 */
export function tryRequireOtelSdkSync(): OtelSdkModule | null {
  try {
    // Read `process` untyped: the ambient Node types claim it always exists,
    // but this guard is exactly for non-Node runtimes where it doesn't.
    const proc: unknown = Reflect.get(globalThis, "process");
    if (proc == null || typeof proc !== "object") return null;
    const getBuiltinModule = Reflect.get(proc, "getBuiltinModule");
    if (typeof getBuiltinModule !== "function") return null;
    const nodeModule = getBuiltinModule.call(proc, "module") as {
      createRequire?: (url: string | URL) => (id: string) => OtelSdkModule,
    } | null;
    if (nodeModule == null || typeof nodeModule.createRequire !== "function") return null;

    const urls = [import.meta.url];
    // dist/esm/... → dist/... CJS twin, which createRequire can load.
    if (import.meta.url.includes("/dist/esm/")) {
      urls.push(import.meta.url.replace("/dist/esm/", "/dist/"));
    }

    for (const url of urls) {
      const require = nodeModule.createRequire(url);
      for (const id of otelSdkSpecifiers()) {
        try {
          const mod = require(id);
          if (typeof mod.registerManagedOtel === "function") return mod;
        } catch {
          // try next candidate
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

let otelSdkImportPromise: Promise<OtelSdkModule | null> | null = null;

/** Async load; works for ESM dist and Vitest source resolution. */
export function importOtelSdk(): Promise<OtelSdkModule | null> {
  if (otelSdkImportPromise === null) {
    otelSdkImportPromise = (async (): Promise<OtelSdkModule | null> => {
      for (const specifier of otelSdkSpecifiers()) {
        try {
          const mod = await import(/* @vite-ignore */ /* webpackIgnore: true */ specifier) as OtelSdkModule;
          if (typeof mod.registerManagedOtel === "function") return mod;
        } catch {
          // try next candidate
        }
      }
      return null;
    })();
  }
  return otelSdkImportPromise;
}

export async function registerManagedOtelAsync(options: ManagedOtelOptions): Promise<ManagedOtelRegistration> {
  const sync = tryRequireOtelSdkSync();
  if (sync !== null) return sync.registerManagedOtel(options);
  const mod = await importOtelSdk();
  if (mod === null) {
    throw new Error("Hexclave managed OpenTelemetry requires a Node.js runtime; the Node OTel SDK could not be loaded");
  }
  return mod.registerManagedOtel(options);
}
