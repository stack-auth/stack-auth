import {
  generateProtectedResourceMetadata,
  metadataCorsOptionsRequestHandler,
} from "@vercel/mcp-adapter";

import { getHexclaveServerApp } from "@/mcp-auth";
import { getMcpConfig } from "@/mcp-config";

export function GET() {
  const config = getMcpConfig();
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [getHexclaveServerApp().getOAuthIssuerUrl()],
    resourceUrl: config.resourceUri,
  });
  return Response.json(metadata, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
