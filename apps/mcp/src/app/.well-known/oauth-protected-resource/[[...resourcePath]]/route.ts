import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "@vercel/mcp-adapter";

import { getMcpOAuthConfig, MCP_RESOURCE_PATHNAMES } from "@/oauth";

export function GET(request: Request) {
  const config = getMcpOAuthConfig();
  if (config == null) {
    return new Response(null, { status: 404 });
  }
  const resourcePathname = new URL(request.url).pathname.replace(/^\/\.well-known\/oauth-protected-resource/, "");
  if (!MCP_RESOURCE_PATHNAMES.has(resourcePathname)) {
    return new Response(null, { status: 404 });
  }
  return protectedResourceHandler({ authServerUrls: [config.issuer] })(request);
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
