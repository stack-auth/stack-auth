/** Vercel's outer ceiling for the single shared Elysia function. */
export const VERCEL_FUNCTION_MAX_DURATION_SECONDS = 800;

/** Matches Vercel Fluid Compute's default when a route has no override. */
export const DEFAULT_ROUTE_MAX_DURATION_SECONDS = 300;

// maxDuration is a total invocation budget. Stop route work ten seconds before
// that budget so cooperative cancellation has time to release request-owned
// resources and Vercel still receives the final response/check-in.
export const ROUTE_DRAIN_GRACE_MS = 8000;
export const ROUTE_TERMINATION_BUFFER_MS = 2000;

export function validateRouteMaxDurationSeconds(value: number, normalizedPath: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > VERCEL_FUNCTION_MAX_DURATION_SECONDS) {
    throw new Error(
      `Route ${normalizedPath} maxDuration must be a positive integer no greater than ${VERCEL_FUNCTION_MAX_DURATION_SECONDS}; received ${value}.`,
    );
  }
  const durationMs = value * 1000;
  if (durationMs <= ROUTE_DRAIN_GRACE_MS + ROUTE_TERMINATION_BUFFER_MS) {
    throw new Error(`Route ${normalizedPath} maxDuration does not leave enough time for graceful cancellation.`);
  }
  return value;
}
