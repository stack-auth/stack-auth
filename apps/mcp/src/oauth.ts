import { createMcpTokenVerifier, getOAuthIssuerUrl, type McpTokenVerifier } from "@hexclave/js/mcp";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { withMcpAuth } from "@vercel/mcp-adapter";

import { getBackendApiBaseUrl } from "@/env";

/**
 * MCP OAuth (the MCP authorization spec) for Hexclave's own MCP server, dogfooding the project
 * OAuth provider: a Hexclave project acts as the authorization server and this app is a resource
 * server verifying its tokens with `createMcpTokenVerifier` — the exact wiring we document for
 * customers' MCP servers.
 *
 * Authorization is *required* by default: anonymous MCP requests get a 401 with an RFC 9728
 * `WWW-Authenticate` challenge. That is what makes MCP clients actually start the OAuth flow —
 * they never authenticate spontaneously, only in response to a challenge — so "optional" auth is
 * invisible in every real client. Set `HEXCLAVE_MCP_OAUTH_OPTIONAL=true` to instead let anonymous
 * requests through while still verifying presented tokens (a migration mode for rolling OAuth out
 * on an already-public deployment without cutting off existing anonymous users).
 */

export type McpOAuthConfig = {
  projectId: string,
  issuer: string,
  verifier: McpTokenVerifier,
};

export const MCP_RESOURCE_PATHNAMES = new Set(["/mcp", "/api/internal/mcp"]);

let cachedConfig: McpOAuthConfig | null | undefined;

export function getMcpOAuthConfig(): McpOAuthConfig | null {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }
  const projectId = getEnvVariable("HEXCLAVE_MCP_OAUTH_PROJECT_ID", "");
  if (projectId === "") {
    cachedConfig = null;
    return cachedConfig;
  }
  const baseUrl = getBackendApiBaseUrl();
  cachedConfig = {
    projectId,
    issuer: getOAuthIssuerUrl({ projectId, baseUrl }),
    verifier: createMcpTokenVerifier({ projectId, baseUrl }),
  };
  return cachedConfig;
}

export function getProtectedResourceMetadataPath(resourcePathname: string): string {
  // RFC 9728 path insertion: metadata for `/mcp` lives at `/.well-known/oauth-protected-resource/mcp`.
  return `/.well-known/oauth-protected-resource${resourcePathname}`;
}

export function withHexclaveMcpOAuth(
  handler: (request: Request) => Response | Promise<Response>,
): (request: Request) => Promise<Response> {
  const wrappers = new Map<string, (request: Request) => Promise<Response>>();
  return async (request: Request) => {
    const config = getMcpOAuthConfig();
    if (config == null) {
      return await handler(request);
    }
    const pathname = new URL(request.url).pathname;
    const cached = wrappers.get(pathname);
    if (cached !== undefined) {
      return await cached(request);
    }
    const wrap = () => withMcpAuth(handler, config.verifier, {
      required: getEnvVariable("HEXCLAVE_MCP_OAUTH_OPTIONAL", "") !== "true",
      resourceMetadataPath: getProtectedResourceMetadataPath(pathname),
    });
    if (!MCP_RESOURCE_PATHNAMES.has(pathname)) {
      return await wrap()(request);
    }
    const wrapper = wrap();
    wrappers.set(pathname, wrapper);
    return await wrapper(request);
  };
}
