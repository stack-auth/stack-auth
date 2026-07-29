import { AsyncLocalStorage } from "node:async_hooks";

import { StackServerApp, type ServerUser } from "@hexclave/next";
import { withMcpAuth } from "@vercel/mcp-adapter";

import { getMcpConfig } from "@/mcp-config";

type McpRequestContext = {
  authInfo: NonNullable<Request["auth"]>,
  user: ServerUser,
};

const mcpUserContext = new AsyncLocalStorage<McpRequestContext>();

let serverApp: StackServerApp | undefined;

export function getHexclaveServerApp(): StackServerApp {
  if (serverApp === undefined) {
    const config = getMcpConfig();
    serverApp = new StackServerApp({
      projectId: config.projectId,
      baseUrl: config.apiUrl,
      secretServerKey: config.serverKey,
      tokenStore: null,
      noAutomaticPrefetch: true,
    });
  }
  return serverApp;
}

export const authenticatedMcpHandler = (handler: (request: Request) => Response | Promise<Response>) =>
  async (request: Request) => {
    const config = getMcpConfig();
    const app = getHexclaveServerApp();
    const verifier = app.createMcpTokenVerifier({ resource: config.resourceUri });
    return await withMcpAuth(
      async (authenticatedRequest) => {
        const authInfo = authenticatedRequest.auth;
        if (authInfo === undefined) {
          return await handler(authenticatedRequest);
        }

        const user = await app.getUser({ from: "mcp", authInfo });
        if (user === null) {
          return new Response("The authenticated Hexclave user no longer exists.", { status: 401 });
        }

        return await mcpUserContext.run({ authInfo, user }, () => handler(authenticatedRequest));
      },
      verifier,
      { required: false },
    )(request);
  };

export function getMcpRequestContext(): McpRequestContext | null {
  return mcpUserContext.getStore() ?? null;
}

export function getMcpAuthenticationHeaders(accessToken: string): Headers {
  const config = getMcpConfig();
  return new Headers({
    "x-hexclave-access-type": "client",
    "x-hexclave-project-id": config.projectId,
    "x-hexclave-publishable-client-key": config.publishableKey,
    "x-hexclave-access-token": accessToken,
  });
}
