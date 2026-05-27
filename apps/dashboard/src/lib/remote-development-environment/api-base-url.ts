import { getPublicEnvVar } from "@/lib/env";
import { createUrlIfValid } from "@stackframe/stack-shared/dist/utils/urls";

const DEFAULT_REMOTE_DEVELOPMENT_ENVIRONMENT_API_BASE_URLS = [
  "https://api.hexclave.com",
] as const;

function canonicalApiBaseUrl(value: string | undefined): string | null {
  if (value == null || value.trim().length === 0) return null;
  const url = createUrlIfValid(value.trim());
  if (url == null || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

function apiBaseUrlAllowlistEntries(): string[] {
  return [
    ...DEFAULT_REMOTE_DEVELOPMENT_ENVIRONMENT_API_BASE_URLS,
    process.env.STACK_API_URL,
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL"),
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL"),
    getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_API_URL"),
    ...(process.env.STACK_RDE_API_BASE_URL_ALLOWLIST ?? "").split(","),
  ].map(canonicalApiBaseUrl).filter((url): url is string => url != null);
}

export function isAllowedRemoteDevelopmentEnvironmentApiBaseUrl(value: string): boolean {
  const canonicalUrl = canonicalApiBaseUrl(value);
  if (canonicalUrl == null) return false;
  return new Set(apiBaseUrlAllowlistEntries()).has(canonicalUrl);
}
