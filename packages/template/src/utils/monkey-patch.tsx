import { createGlobal } from "@hexclave/shared/dist/utils/globals";

export const NO_SUSPENSE_BOUNDARY_ERROR_SENTINEL = "__stack-no-suspense-boundary-error__";

export function isNoSuspenseBoundaryError(value: unknown): boolean {
  return (
    typeof value === "object"
    && value !== null
    && "__noSuspenseBoundarySentinel" in value
    && value.__noSuspenseBoundarySentinel === NO_SUSPENSE_BOUNDARY_ERROR_SENTINEL
  );
}

export function ensureMonkeyPatch() {
  createGlobal("__console-error-monkey-patch__", () => {
    const originalConsoleError = console.error;
    console.error = function (...args: unknown[]) {
      // React's default error handlers log every server error, including the one we intentionally throw to skip SSR.
      // Frameworks that use those defaults (including vanilla React) therefore need this narrow sentinel-based filter.
      if (args.length === 1 && isNoSuspenseBoundaryError(args[0])) {
        return;
      }
      return originalConsoleError.apply(this, args);
    };
    return true;
  });
}
