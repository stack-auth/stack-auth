import { CLOUD_HOST_PAIRS } from "@stackframe/stack-shared/dist/utils/cloud-hosts";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, HexclaveAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

/**
 * The stack-auth ↔ hexclave cloud host pairs live in stack-shared
 * (`utils/cloud-hosts.ts`) so the dashboard and OAuth callback logic can share
 * them. Re-exported here because `tokens.tsx` imports it from this module to
 * build `issuerHostAliases` (and the source-of-truth comment lives with the
 * pairs themselves).
 */
export { CLOUD_HOST_PAIRS };

/**
 * Cloud hosts where this backend serves customer SDK traffic. Each request
 * that arrives on one of these hosts is treated as "branded" to its canonical
 * API host: the JWT `iss` claim and the OAuth `redirect_uri` we send to
 * providers (Google, GitHub, ...) both use the same brand the SDK targeted.
 * That way a customer whose SDK is on `api.stack-auth.com` continues to
 * receive `iss: api.stack-auth.com/...` tokens and OAuth redirect URIs
 * registered with their provider apps as
 * `https://api.stack-auth.com/api/v1/auth/oauth/callback/<provider>`, and a
 * customer whose SDK is on `api.hexclave.com` gets the hexclave-branded
 * equivalents.
 *
 * Fallback/analytics hosts (`api1`, `api2`, `api3`, `r`) map back to the
 * canonical `api` host for the same brand/environment. We should never stamp
 * those load-balancing or recording hosts into customer-facing OAuth callback
 * URLs or JWT issuers.
 *
 * Hosts NOT in this map (localhost, vercel preview URLs, self-host custom
 * domains) fall back to `NEXT_PUBLIC_STACK_API_URL` so single-host deployments
 * keep behaving exactly as before. We capture those fallbacks as errors so
 * missed cloud host aliases are visible during the rebrand rollout.
 *
 * Trust model: on Vercel, `x-forwarded-host` is set by the edge from the
 * customer-facing hostname and cannot be spoofed by a client. The blast
 * radius of any host-header manipulation is bounded to the allowlist above
 * — a spoofed host that isn't in the list falls back to the env-var default,
 * and the resulting `iss` would still validate via `issuerHostAliases`. The
 * helper does NOT gate on a trusted-proxy signal; it assumes the deployment's
 * proxy chain sets `x-forwarded-host` from a trusted source.
 */
function apiHostAliasesForCanonicalHost(canonicalHost: string): string[] {
  const suffix = canonicalHost.slice("api.".length);
  return [
    canonicalHost,
    `api1.${suffix}`,
    `api2.${suffix}`,
    `api3.${suffix}`,
    `r.${suffix}`,
    ...suffix.startsWith("dev.") ? [`app.${suffix}`] : [],
  ];
}

const CLOUD_API_HOST_BY_REQUEST_HOST = new Map<string, string>(
  CLOUD_HOST_PAIRS
    .flat()
    .flatMap((canonicalHost) => (
      apiHostAliasesForCanonicalHost(canonicalHost).map((requestHost) => [requestHost, canonicalHost] as const)
    )),
);

function normalizeRequestHost(host: string | undefined | null): string | undefined {
  if (!host) return undefined;
  const firstHost = host.split(",")[0]?.trim();
  if (!firstHost) return undefined;
  return firstHost.split(":")[0].toLowerCase();
}

/**
 * Map a request's host header to the canonical API URL to use for any outward-
 * facing identifier produced for that request (JWT issuer, OAuth redirect URI,
 * etc.). Pass the bare hostname (no scheme, no port).
 */
export function getApiUrlForHost(host: string | undefined | null): string {
  const normalizedHost = normalizeRequestHost(host);
  if (normalizedHost) {
    const apiHost = CLOUD_API_HOST_BY_REQUEST_HOST.get(normalizedHost);
    if (apiHost) {
      return `https://${apiHost}`;
    }
  }
  const fallbackApiUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
  captureError("request-api-url.fallback", new HexclaveAssertionError(`Falling back to NEXT_PUBLIC_STACK_API_URL while resolving request API URL`, {
    host,
    normalizedHost,
    fallbackApiUrl,
  }));
  return fallbackApiUrl;
}

/**
 * Resolve the API URL for the host the incoming request is targeting. Prefers
 * `x-forwarded-host` (set by Vercel's edge proxy) over `host` so we see the
 * customer-facing hostname rather than the internal one.
 *
 * The `headers` shape matches what `smart-route-handler` exposes as `fullReq`:
 * a record of lowercase header names to value arrays.
 */
export function getApiUrlForRequest(req: { headers: Record<string, string[] | undefined> }): string {
  const host = req.headers["x-forwarded-host"]?.[0] ?? req.headers["host"]?.[0];
  return getApiUrlForHost(host);
}

import.meta.vitest?.test("getApiUrlForHost maps cloud sibling hosts to canonical API hosts", ({ expect }) => {
  for (const [stackAuthHost, hexclaveHost] of CLOUD_HOST_PAIRS) {
    for (const canonicalHost of [stackAuthHost, hexclaveHost]) {
      const suffix = canonicalHost.slice("api.".length);
      for (const prefix of ["api", "api1", "api2", "api3", "r"]) {
        expect(getApiUrlForHost(`${prefix}.${suffix}`)).toBe(`https://${canonicalHost}`);
        expect(getApiUrlForHost(`${prefix.toUpperCase()}.${suffix}:443`)).toBe(`https://${canonicalHost}`);
      }
    }
  }
});

import.meta.vitest?.test("getApiUrlForHost maps app.dev sibling hosts to canonical dev API hosts", ({ expect }) => {
  expect(getApiUrlForHost("app.dev.stack-auth.com")).toBe("https://api.dev.stack-auth.com");
  expect(getApiUrlForHost("app.dev.hexclave.com")).toBe("https://api.dev.hexclave.com");
});
