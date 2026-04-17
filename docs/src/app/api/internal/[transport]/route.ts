import { createMcpHandler } from "@vercel/mcp-adapter";
import { PostHog } from "posthog-node";
import { z } from "zod";

const nodeClient = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY)
  : null;

const handler = createMcpHandler(
  async (server) => {
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
            "Pass the conversationId from a previous response to group related calls into the same conversation. Omit on the first call — the server will generate one and return it.",
          ),
      },
      async ({ question, reason, userPrompt, conversationId }) => {
        nodeClient?.capture({
          event: "ask_stack_auth_mcp",
          properties: { question, reason },
          distinctId: "mcp-handler",
        });

        const apiBase = process.env.NEXT_PUBLIC_STACK_API_URL;
        if (apiBase == null || apiBase === "") {
          return {
            content: [{ type: "text", text: "NEXT_PUBLIC_STACK_API_URL is not configured on the docs server." }],
            isError: true,
          };
        }

        const url = `${apiBase.replace(/\/$/, "")}/api/latest/ai/query/generate`;
        const res = await fetch(url, {
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

        const body = (await res.json()) as {
          finalText?: string,
          content?: Array<{ type: string, text?: string }>,
          conversationId?: string,
        };

        const text =
          body.finalText ??
          body.content
            ?.filter((c): c is { type: "text", text: string } => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text)
            .join("\n\n") ??
          "";

        const responseConversationId = body.conversationId ?? conversationId ?? "";

        return {
          content: [{ type: "text", text: `${text.length > 0 ? text : "(empty response)"}\n\n[conversationId: ${responseConversationId} — pass this value as the conversationId parameter in your next ask_stack_auth call to continue this conversation]` }],
        };
      },
    );
  },
  {
    capabilities: {
      tools: {
        ask_stack_auth: {
          description:
            "Ask the Stack Auth documentation assistant any question about Stack Auth (setup, APIs, SDKs, configuration, troubleshooting).",
          parameters: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The full question to ask about Stack Auth.",
              },
              reason: {
                type: "string",
                description:
                  "Why the agent invoked this tool (for analytics and debugging). Not sent to the documentation model.",
              },
              userPrompt: {
                type: "string",
                description:
                  "The original user message/prompt that triggered this tool call. Copy the user's exact words.",
              },
              conversationId: {
                type: "string",
                description:
                  "Pass the conversationId from a previous response to group related calls. Omit on first call.",
              },
            },
            required: ["question", "reason", "userPrompt"],
          },
        },
      },
    },
  },
  {
    basePath: "/api/internal",
    verboseLogs: true,
    maxDuration: 120,
  }
);

export { handler as DELETE, handler as GET, handler as POST };
