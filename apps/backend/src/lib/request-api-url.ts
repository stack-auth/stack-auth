import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

/**
 * Single source of truth for the stack-auth ↔ hexclave host pairs that this
 * backend treats as equivalent siblings. Each `[stackAuthHost, hexclaveHost]`
 * pair is used in two places:
 *
 * 1. `CLOUD_API_HOSTS` below — the allowlist of hosts whose name we are
 *    willing to stamp into a JWT `iss` claim or an OAuth `redirect_uri`.
 * 2. `issuerHostAliases` in `tokens.tsx` — the bidirectional validator alias
 *    map, so a token issued under either host validates against the other.
 *
 * Deriving both lists from this single list prevents drift (a host can sign
 * but no sibling can validate, or vice versa) — that bug ate us once on the
 * staging pair before this consolidation.
 */
export const CLOUD_HOST_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["api.stack-auth.com", "api.hexclave.com"],
  ["api.dev.stack-auth.com", "api.dev.hexclave.com"],
  ["api.staging.stack-auth.com", "api.staging.hexclave.com"],
];

/**
 * Cloud hosts where this backend serves customer SDK traffic. Each request
 * that arrives on one of these hosts is treated as "branded" to that host:
 * the JWT `iss` claim and the OAuth `redirect_uri` we send to providers
 * (Google, GitHub, ...) both use the same host the SDK targeted. That way a
 * customer whose SDK is on `api.stack-auth.com` continues to receive
 * `iss: api.stack-auth.com/...` tokens and OAuth redirect URIs registered
 * with their provider apps as
 * `https://api.stack-auth.com/api/v1/auth/oauth/callback/<provider>`, and a
 * customer whose SDK is on `api.hexclave.com` gets the hexclave-branded
 * equivalents.
 *
 * Hosts NOT in this Set (localhost, vercel preview URLs, self-host custom
 * domains) fall back to `NEXT_PUBLIC_STACK_API_URL` so single-host deployments
 * keep behaving exactly as before.
 *
 * Trust model: on Vercel, `x-forwarded-host` is set by the edge from the
 * customer-facing hostname and cannot be spoofed by a client. The blast
 * radius of any host-header manipulation is bounded to the allowlist above
 * — a spoofed host that isn't in the list falls back to the env-var default,
 * and the resulting `iss` would still validate via `issuerHostAliases`. The
 * helper does NOT gate on a trusted-proxy signal; it assumes the deployment's
 * proxy chain sets `x-forwarded-host` from a trusted source.
 */
const CLOUD_API_HOSTS = new Set<string>(CLOUD_HOST_PAIRS.flat());

/**
 * Map a request's host header to the canonical API URL to use for any outward-
 * facing identifier produced for that request (JWT issuer, OAuth redirect URI,
 * etc.). Pass the bare hostname (no scheme, no port).
 */
export function getApiUrlForHost(host: string | undefined | null): string {
  if (host) {
    // Strip port if present and lowercase for case-insensitive comparison —
    // hostnames are case-insensitive per RFC 3986.
    const hostLower = host.split(":")[0].toLowerCase();
    if (CLOUD_API_HOSTS.has(hostLower)) {
      return `https://${hostLower}`;
    }
  }
  return getEnvVariable("NEXT_PUBLIC_STACK_API_URL");
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
