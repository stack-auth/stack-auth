import { installFetchSpanPropagation, type FetchSpanPropagationOptions } from "./span-propagation";

/**
 * Server-side install of the global fetch wrapper (span-propagation.ts is
 * runtime-agnostic — same wrapper, server-flavored provider): one
 * `$http-client` span per outgoing server request, and the span-context header
 * + traceparent for allowlisted origins (server→server; CORS does not apply,
 * but the origin policy still does — see the provider construction in
 * server-app-impl for why the automatic wrapper never bypasses it).
 *
 * Ordering note for Next.js (and any framework that patches fetch itself):
 * this installs LAZILY — on the first `withSpan({ request })` or via
 * `hexclaveInstrumentation().register()` from the customer's
 * `instrumentation.ts` — which runs after Next.js has applied its own fetch
 * patch, so Next's data-cache/dedupe layer sits UNDERNEATH our wrapper and
 * both compose. Installing at module-eval time could race that patch.
 *
 * No XHR counterpart here: XMLHttpRequest does not exist in server runtimes.
 */

/** Marker on globalThis: projectId → uninstaller of that project's provider. */
const SERVER_FETCH_INSTRUMENTATION_MARKER = "__hexclaveServerFetchInstrumentation";

function getRegistry(): Map<string, () => void> {
  const g = globalThis as typeof globalThis & Record<string, unknown>;
  const existing = g[SERVER_FETCH_INSTRUMENTATION_MARKER];
  // instanceof narrows to Map<any, any>; the values were only ever written by
  // this module, so they are the uninstallers the return type declares.
  if (existing instanceof Map) return existing;
  const registry = new Map<string, () => void>();
  g[SERVER_FETCH_INSTRUMENTATION_MARKER] = registry;
  return registry;
}

/**
 * Installs (or replaces) the outbound-fetch provider for one project.
 * REPLACE semantics keyed by projectId: dev-server HMR re-evaluates the app
 * module and constructs a fresh app instance, and keeping the previous
 * instance's provider registered alongside the new one would open duplicate
 * `$http-client` spans for every request (and make header attachment fail
 * closed on the two differing candidates). The newest instance wins; the old
 * provider is uninstalled first.
 */
export function installServerFetchInstrumentation(opts: {
  projectId: string,
  provider: FetchSpanPropagationOptions,
}): (() => void) | null {
  const registry = getRegistry();
  const previous = registry.get(opts.projectId);
  if (previous !== undefined) {
    previous();
    registry.delete(opts.projectId);
  }
  const uninstall = installFetchSpanPropagation(opts.provider);
  if (uninstall === null) return null;
  const uninstallAndUnregister = () => {
    uninstall();
    if (registry.get(opts.projectId) === uninstallAndUnregister) {
      registry.delete(opts.projectId);
    }
  };
  registry.set(opts.projectId, uninstallAndUnregister);
  return uninstallAndUnregister;
}
