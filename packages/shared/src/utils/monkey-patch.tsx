import { createGlobal } from "./globals";

export const NO_SUSPENSE_BOUNDARY_ERROR_SENTINEL = "__stack-no-suspense-boundary-error__";

export function isNoSuspenseBoundaryError(value: unknown): boolean {
  return (
    typeof value === "object"
    && value !== null
    && (value as Record<string, unknown>).__noSuspenseBoundarySentinel === NO_SUSPENSE_BOUNDARY_ERROR_SENTINEL
  );
}

export function ensureMonkeyPatch() {
  createGlobal("__console-error-monkey-patch__", () => {
    const originalConsoleError = console.error;
    console.error = function (...args: unknown[]) {
      // React's default error handlers will log all errors to the console, even those that we intentionally use to suppress SSR.
      // Next.js among others override the default error handler and will not log SSR errors to the console.
      // However, vanilla React and other frameworks like TanStack Start use the default error handler.
      // Hence, we suppress the error here if it is a NoSuspenseBoundaryError.
      // It's very cursed, but it's really our best option. Talk to @konsti if you want to know more.
      if (args.length === 1 && isNoSuspenseBoundaryError(args[0])) {
        return;
      }
      return originalConsoleError.apply(this, args);
    };
    return true;
  });
}
