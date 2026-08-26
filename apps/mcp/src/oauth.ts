import { createMcpTokenVerifier, getOAuthIssuerUrl, type McpTokenVerifier } from "@hexclave/js/mcp";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { withMcpAuth } from "@vercel/mcp-adapter";

export function getBackendApiBaseUrl(): string {
  return (
    getEnvVariable("NEXT_PUBLIC_SERVER_HEXCLAVE_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_SERVER_STACK_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_HEXCLAVE_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_STACK_API_URL")
  ).replace(/\/$/, "");
}

export type McpOAuthConfig = {
  projectId: string,
  issuer: string,
  verifier: McpTokenVerifier,
};

export const MCP_RESOURCE_PATHNAMES = new Set(["/mcp", "/api/internal/mcp"]);

let cachedConfig: McpOAuthConfig | null | undefined;

/** Tokens come from the internal project's OAuth provider. Auth is required so clients start from the 401 challenge. */
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
      required: true,
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
