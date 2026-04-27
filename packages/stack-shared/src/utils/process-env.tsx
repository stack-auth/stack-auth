/**
 * Browser-safe access to `process.env`.
 *
 * Bare `process.env.X` references throw `ReferenceError: process is not defined`
 * in browser bundlers that don't shim `process` (e.g. Vite). This helper
 * returns `undefined` in that environment instead of throwing.
 *
 * Bundlers like Next.js still inline `process.env.NEXT_PUBLIC_*` because the
 * literal `process.env.NAME` expression appears in the source.
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
