import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors"
import type {MetricsResponse} from "@stackframe/stack-shared/dist/interface/admin-metrics";
import type { StackAdminApp } from "@stackframe/tanstack-start"

const stackAppInternalsSymbol = Symbol.for(
  "StackAuth--DO-NOT-USE-OR-YOU-WILL-BE-FIRED--StackAppInternals",
)

export function useMetrics(
  adminApp: StackAdminApp<false>,
  includeAnonymous: boolean = false,
): MetricsResponse {
  const internals = Reflect.get(adminApp, stackAppInternalsSymbol)
  if (typeof internals !== "object" || internals == null || !("useMetrics" in internals)) {
    throw new StackAssertionError("Admin app internals are unavailable: missing useMetrics")
  }
  const fn = (internals as { useMetrics: unknown }).useMetrics
  if (typeof fn !== "function") {
    throw new StackAssertionError("Admin app internals are unavailable: useMetrics is not callable")
  }
  return fn(includeAnonymous) as MetricsResponse
}
