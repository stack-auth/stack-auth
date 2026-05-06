import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { createMcpHandler } from "@vercel/mcp-adapter";
import { z } from "zod";

import withPostHog from "@/analytics";
import packageJson from "../package.json";

function getBackendApiBaseUrl(): string {
  return (
    getEnvVariable("NEXT_PUBLIC_SERVER_STACK_API_URL", "") ||
    getEnvVariable("NEXT_PUBLIC_STACK_API_URL")
  ).replace(/\/$/, "");
}

type AiTextContent = {
  type: "text",
  text: string,
};

type AiQueryResponse = {
  finalText?: string,
  content?: AiTextContent[],
  conversationId?: string,
};

const setupResourceUri = "stack-auth://mcp/setup";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAiQueryResponse(value: unknown): AiQueryResponse {
  if (!isRecord(value)) {
    return {};
  }

  const parsed: AiQueryResponse = {};

  if (typeof value.finalText === "string") {
    parsed.finalText = value.finalText;
  }

  if (typeof value.conversationId === "string") {
    parsed.conversationId = value.conversationId;
  }

  if (Array.isArray(value.content)) {
    parsed.content = value.content.flatMap((contentItem) => {
      if (!isRecord(contentItem) || contentItem.type !== "text" || typeof contentItem.text !== "string") {
        return [];
      }

      return [{
        type: "text",
        text: contentItem.text,
      }];
    });
  }

  return parsed;
}

export function createStackMcpHandler(config: { streamableHttpEndpoint: string }) {
  return createMcpHandler(
    async (server) => {
      server.resource(
        "stack-auth-mcp-setup",
        setupResourceUri,
        {
          title: "Stack Auth MCP setup",
          description: "Setup instructions for the Stack Auth MCP server.",
          mimeType: "text/markdown",
        },
        () => ({
          contents: [{
            uri: setupResourceUri,
            mimeType: "text/markdown",
            text: `# Stack Auth MCP

Use this MCP server to ask Stack Auth documentation questions with the ask_stack_auth tool.

Server URL: ${config.streamableHttpEndpoint}

Tool: ask_stack_auth
- question: the Stack Auth question to answer
- reason: why the agent is calling the tool
- userPrompt: the original user prompt that triggered the call
- conversationId: optional ID from an earlier response
`,
          }],
        }),
      );

      server.prompt(
        "ask_stack_auth",
        "Ask the Stack Auth documentation assistant a question.",
        {
          question: z.string().describe("The Stack Auth question to ask."),
        },
        ({ question }) => ({
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: `Use the ask_stack_auth tool to answer this Stack Auth question: ${question}`,
            },
          }],
        }),
      );

      server.tool(
        "ask_stack_auth",
        "Ask the Stack Auth documentation assistant. Use this for any question about Stack Auth: setup, APIs, SDK usage, configuration, or troubleshooting. The assistant searches official documentation and answers with citations. Always set `reason` to a short explanation of why you are calling this tool (for product analytics and debugging).",
        {
          question: z.string().describe("The full question to ask about Stack Auth."),
          reason: z
            .string()
            .min(1)
            .describe(
              "Why the agent invoked this tool (e.g. user asked about OAuth setup, need Stack Auth API headers). Used for analytics, not sent to the model.",
            ),
          userPrompt: z
            .string()
            .min(1)
            .describe(
              "The original user message/prompt that triggered this tool call. Copy the user's exact words. Don't include any sensitive information.",
            ),
          conversationId: z
            .string()
            .optional()
            .describe(
              "Pass the conversationId from a previous response to group related calls into the same conversation. Omit on the first call - the server will generate one and return it.",
            ),
        },
        async ({ question, reason, userPrompt, conversationId }) => {
          await withPostHog(async (posthog) => {
            posthog.capture({
              event: "ask_stack_auth_mcp",
              properties: { question, reason },
              distinctId: "mcp-handler",
            });
          });

          const res = await fetch(`${getBackendApiBaseUrl()}/api/latest/ai/query/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              quality: "smart",
              speed: "fast",
              tools: ["docs"],
              systemPrompt: "docs-ask-ai",
              messages: [{ role: "user", content: question }],
              mcpCallMetadata: { toolName: "ask_stack_auth", reason, userPrompt, conversationId },
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            return {
              content: [{ type: "text", text: `Stack Auth AI error (${res.status}): ${errText}` }],
              isError: true,
            };
          }

          const body = parseAiQueryResponse(await res.json());

          const contentText = body.content?.map((c) => c.text).join("\n\n");
          const text = body.finalText ?? contentText ?? "";

          const responseConversationId = body.conversationId ?? conversationId ?? "";

          return {
            content: [{ type: "text", text: `${text.length > 0 ? text : "(empty response)"}\n\n[conversationId: ${responseConversationId} - pass this value as the conversationId parameter in your next ask_stack_auth call to continue this conversation]` }],
          };
        },
      );
    },
    {
      serverInfo: {
        name: "stack-auth-mcp",
        version: packageJson.version,
      },
    },
    {
      streamableHttpEndpoint: config.streamableHttpEndpoint,
      verboseLogs: true,
      maxDuration: 120,
    },
  );
}
