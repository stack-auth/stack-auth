import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { tool } from "ai";
import { z } from "zod";

let mintlifyMcpClientPromise: Promise<MCPClient> | null = null;

function getMintlifyMcpUrl(): string {
  return getEnvVariable("STACK_MINTLIFY_MCP_URL", "https://stackauth-e0affa27.mintlify.app/mcp");
}

async function getMintlifyMcpClient(): Promise<MCPClient> {
  if (mintlifyMcpClientPromise == null) {
    mintlifyMcpClientPromise = createMCPClient({
      transport: {
        type: "http",
        url: getMintlifyMcpUrl(),
      },
      name: "stack-auth-backend-docs-agent",
    }).catch((err: unknown) => {
      mintlifyMcpClientPromise = null;
      throw err;
    });
  }

  return await mintlifyMcpClientPromise;
}

/**
 * Documentation tools backed by Mintlify's generated MCP server.
 * The public Stack Auth MCP server still exposes the higher-level `ask_stack_auth` tool;
 * that agent uses these lower-level Mintlify tools for search and page reads.
 */
export async function createDocsTools() {
  try {
    const client = await getMintlifyMcpClient();
    return await client.tools();
  } catch (error) {
    captureError("mintlify-mcp-docs-tools", error);
    return {
      docsUnavailable: tool({
        description: "Report that the Stack Auth documentation search tools are currently unavailable.",
        inputSchema: z.object({}),
        execute: async () => ({
          error: "Stack Auth documentation search is temporarily unavailable. Please try again later.",
        }),
      }),
    };
  }
}
