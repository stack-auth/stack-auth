import { throwErr } from "@hexclave/shared/dist/utils/errors";

export const DEMO_CLIENT_ID = "demoClient";
export const DEMO_TRUSTED_CLIENT_ID = "demoTrustedClient";

const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX || "81";

export function getProjectId(): string {
  return process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID ?? throwErr("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID is not set; the demo app requires it");
}

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_HEXCLAVE_API_URL ?? throwErr("NEXT_PUBLIC_HEXCLAVE_API_URL is not set; the demo app requires it");
}

export function getDemoOrigin(): string {
  return `http://localhost:${portPrefix}03`;
}

export function getDemoResourceUri(): string {
  return `${getDemoOrigin()}/oauth-provider-demo/api/mcp`;
}

export function getDemoCallbackUrl(): string {
  return `${getDemoOrigin()}/oauth-provider-demo/callback`;
}

export function getIssuerUrl(): string {
  return `${getApiBaseUrl()}/api/v1/projects/${encodeURIComponent(getProjectId())}/oidc`;
}

export const OAUTH_SCOPE = "openid profile email offline_access";

// Next.js App Router route files may only export handlers, so this metadata lives here.
export const DEMO_TEST_CASES = [
  { id: "discovery", title: "Discovery documents & JWKS", description: "Metadata docs are identical, CORS-readable, and the JWKS publishes signing keys." },
  { id: "happy-path", title: "Full happy path", description: "authorize → consent → code → token → SDK verify → getUser → refresh → revoke; provider token is rejected as a session token." },
  { id: "interaction-details", title: "Interaction details", description: "The consent endpoint reports client, resource, and trust level." },
  { id: "trusted-client", title: "Trusted client", description: "demoTrustedClient is flagged trusted, so the hosted page skips the consent prompt." },
  { id: "deny-and-replay", title: "Deny & replay", description: "Denied consent yields error=access_denied; the decision is single-use." },
  { id: "pkce-required", title: "PKCE required", description: "Authorize without code_challenge redirects with error=invalid_request." },
  { id: "unknown-client", title: "Unknown client", description: "An unregistered client_id answers 400 invalid_client." },
  { id: "undeclared-resource", title: "Undeclared resource", description: "Token exchange for an unregistered resource fails with invalid_target." },
  { id: "wrong-code-verifier", title: "Wrong PKCE verifier", description: "Token exchange with a mismatched code_verifier fails with invalid_grant." },
  { id: "code-replay", title: "Code replay", description: "Authorization codes are single-use." },
  { id: "cross-resource-verifier", title: "Cross-resource verifier", description: "A token minted for this resource is rejected by another resource's verifier (wrong_resource)." },
] as const;

export type DemoTestCaseId = typeof DEMO_TEST_CASES[number]["id"];

export const BROWSER_FLOW_STORAGE_KEY = "oauth-provider-demo-browser-flow";

export type BrowserFlowState = {
  codeVerifier: string,
  clientId: string,
  resource?: string,
  variant: string,
  state: string,
};

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("Not a JWT");
  // JWTs use base64url, not plain base64 — convert before atob.
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(atob(padded));
}
