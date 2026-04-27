/**
 * Browser-safe access to `process.env` for server-only or genuinely dynamic
 * env-var lookups.
 *
 * Bare `process.env.X` references throw `ReferenceError: process is not defined`
 * in browser bundlers that don't shim `process` (e.g. Vite). This helper
 * returns `undefined` in that environment instead of throwing.
 *
 * Note: this helper uses `process.env[name]` (bracket form), which is NOT
 * recognized by Next.js / webpack DefinePlugin for compile-time inlining.
 * `NEXT_PUBLIC_*` vars looked up through this helper still resolve at runtime
 * via Next.js's client-side `process.env` shim, but they will not be inlined
 * into the bundle as constants.
 *
 * If you need build-time inlining for a `NEXT_PUBLIC_*` var, use the literal
 * dot-form at the call site, guarded with `typeof process`:
 *
 *   const value = (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_FOO : undefined);
 *
 * (See `packages/template/src/lib/env.ts` for the established pattern.)
 *
 * This module must have no imports so it is safe to use from anywhere in
 * `stack-shared`, including low-level utilities like `errors.tsx`.
 */
export function getProcessEnv(name: string): string | undefined {
  if (typeof process === "undefined" || typeof process.env === "undefined") {
    return undefined;
  }
  return process.env[name];
}
