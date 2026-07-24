import { getPublicEnvVar } from "@/lib/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

// Shared by the purchase flow client pages. Only callable client-side: NEXT_PUBLIC_STACK_API_URL
// is blank during prerender (sentinel-replacement model), so a missing value here is a
// deployment/config error rather than a normal runtime state.
export function getApiBaseUrl() {
  const apiUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
  return new URL("/api/v1", apiUrl).toString();
}
