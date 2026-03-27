import { createMCPClient } from "@ai-sdk/mcp";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";

/**
 * Creates an MCP client connected to the Stack Auth documentation server.
 *
 * In development: connects to local docs server at http://localhost:8104
 * In production: connects to production docs server at https://mcp.stack-auth.com
 */
export async function createDocsTools() {
  const mcpUrl =
    getNodeEnvironment() === "development"
      ? new URL("/api/internal/mcp", "http://localhost:8104")
      : new URL("/api/internal/mcp", "https://mcp.stack-auth.com");

  const stackAuthMcp = await createMCPClient({
    transport: { type: "http", url: mcpUrl.toString() },
  });

  return await stackAuthMcp.tools();
}
