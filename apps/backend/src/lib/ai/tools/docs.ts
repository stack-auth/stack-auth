import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { tool } from "ai";
import { z } from "zod";

type DocsToolHttpResult = {
  content?: Array<{ type: string, text?: string }>,
  isError?: boolean,
};

function getDocsToolsBaseUrl(): string {
  const fromEnv = getEnvVariable("STACK_DOCS_INTERNAL_BASE_URL", "");
  if (fromEnv !== "") {
    return fromEnv.replace(/\/$/, "");
  }
  if (getNodeEnvironment() === "development") {
    const portPrefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
    return `http://localhost:${portPrefix}26`;
  }
  return "https://mcp.stack-auth.com";
}

async function postDocsToolAction(action: Record<string, unknown>): Promise<string> {
  const base = getDocsToolsBaseUrl();
  try {
    const res = await fetch(`${base}/api/internal/docs-tools`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // MCP-style JSON-RPC endpoint requires clients to advertise both JSON and SSE.
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(action),
    });

    if (!res.ok) {
      const errBody = await res.text();
      captureError("docs-tools-http-error", new Error(`Stack Auth docs tools error (${res.status}): ${errBody}`));
      return "Stack Auth docs tools returned an error. Please try again later.";
    }

    const data = (await res.json()) as DocsToolHttpResult;
    const text = data.content
      ?.filter((c): c is { type: "text", text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n") ?? "";

    if (data.isError === true) {
      return text || "Unknown docs tool error";
    }

    return text;
  } catch (err) {
    captureError("docs-tools-transport-error", err instanceof Error ? err : new Error(String(err)));
    return "Stack Auth docs tools are temporarily unavailable. Please try again later.";
  }
}

/**
 * Documentation tools backed by the docs app's `/api/internal/docs-tools` endpoint.
 *
 * The public MCP server at the same docs origin exposes only `ask_stack_auth`, which proxies to
 * `/api/latest/ai/query/generate`; these tools avoid MCP recursion by calling the HTTP API directly.
 */
export async function createDocsTools() {
  return {
    list_available_docs: tool({
      description:
        "Use this tool to learn about what Stack Auth is, available documentation, and see if you can use it for what you're working on. It returns a list of all available Stack Auth Documentation pages.",
      inputSchema: z.object({}),
      execute: async () => {
        return await postDocsToolAction({ action: "list_available_docs" });
      },
    }),

    search_docs: tool({
      description:
        "Search through all Stack Auth documentation including API docs, guides, and examples. Returns ranked results with snippets and relevance scores.",
      inputSchema: z.object({
        search_query: z.string().describe("The search query to find relevant documentation"),
        result_limit: z.number().optional().describe("Maximum number of results to return (default: 50)"),
      }),
      execute: async ({ search_query, result_limit = 50 }) => {
        return await postDocsToolAction({
          action: "search_docs",
          search_query,
          result_limit,
        });
      },
    }),

    get_docs_by_id: tool({
      description:
        "Use this tool to retrieve a specific Stack Auth Documentation page by its ID. It gives you the full content of the page so you can know exactly how to use specific Stack Auth APIs. Whenever using Stack Auth, you should always check the documentation first to have the most up-to-date information. When you write code using Stack Auth documentation you should reference the content you used in your comments.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        return await postDocsToolAction({ action: "get_docs_by_id", id });
      },
    }),

    get_stack_auth_setup_instructions: tool({
      description:
        "Use this tool when the user wants to set up authentication in a new project. It provides step-by-step instructions for installing and configuring Stack Auth authentication.",
      inputSchema: z.object({}),
      execute: async () => {
        return await postDocsToolAction({ action: "get_stack_auth_setup_instructions" });
      },
    }),

    search: tool({
      description:
        "Search for Stack Auth documentation pages.\n\nUse this tool to find documentation pages that contain a specific keyword or phrase.",
      inputSchema: z.object({
        query: z.string(),
      }),
      execute: async ({ query }) => {
        return await postDocsToolAction({ action: "search", query });
      },
    }),

    fetch: tool({
      description:
        "Fetch a particular Stack Auth Documentation page by its ID.\n\nThis tool is identical to `get_docs_by_id`.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        return await postDocsToolAction({ action: "fetch", id });
      },
    }),
  };
}
