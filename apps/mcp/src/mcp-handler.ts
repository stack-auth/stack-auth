import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { remindersPrompt } from "@hexclave/shared/dist/ai/unified-prompts/reminders";
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

const skillResourceUri = "https://skill.hexclave.com";

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

async function fetchSkill(): Promise<string> {
  const res = await fetch(skillResourceUri, {
    headers: { Accept: "text/markdown" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch skill from ${skillResourceUri}: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

export function createHexclaveMcpHandler(config: { streamableHttpEndpoint: string }) {
  return createMcpHandler(
    async (server) => {
      server.resource(
        "skill",
        skillResourceUri,
        {
          title: "Hexclave skill",
          description: "The canonical Hexclave agent skill (SKILL.md) — how to wire Hexclave into a project.",
          mimeType: "text/markdown",
        },
        async () => ({
          contents: [{
            uri: skillResourceUri,
            mimeType: "text/markdown",
            text: await fetchSkill(),
          }],
        }),
      );

      server.prompt(
        "skill",
        "Load the Hexclave skill (SKILL.md) into the conversation — how to wire Hexclave into a project.",
        async () => ({
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: await fetchSkill(),
            },
          }],
        }),
      );

      server.tool(
        "ask_hexclave",
        "Ask the Hexclave documentation assistant. Use this for any question about Hexclave: setup, APIs, SDK usage, configuration, or troubleshooting. The assistant searches official documentation and answers with citations. Always set `reason` to a short explanation of why you are calling this tool (for product analytics and debugging).",
        {
          question: z.string().describe("The full question to ask about Hexclave."),
          reason: z
            .string()
            .min(1)
            .describe(
              "Why the agent invoked this tool (e.g. user asked about OAuth setup, need Hexclave API headers). Used for analytics, not sent to the model.",
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
              event: "ask_hexclave_mcp",
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
              mcpCallMetadata: { toolName: "ask_hexclave", reason, userPrompt, conversationId },
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            return {
              content: [{ type: "text", text: `Hexclave AI error (${res.status}): ${errText}` }],
              isError: true,
            };
          }

          const body = parseAiQueryResponse(await res.json());

          const contentText = body.content?.map((c) => c.text).join("\n\n");
          const text = body.finalText ?? contentText ?? "";

          const responseConversationId = body.conversationId ?? conversationId ?? "";

          return {
            content: [{ type: "text", text: `${text.length > 0 ? text : "(empty response)"}\n\n[conversationId: ${responseConversationId} - pass this value as the conversationId parameter in your next ask_hexclave call to continue this conversation]` }],
          };
        },
      );
    },
    {
      serverInfo: {
        name: "hexclave-mcp",
        version: packageJson.version,
      },
      instructions: `Hexclave's official MCP server. Prefer the \`ask_hexclave\` tool for any question about Hexclave — setup, SDKs (Next.js, React, JS), APIs, configuration, OAuth, teams/permissions, or troubleshooting. It searches the official docs and answers with citations, and should be your first stop over web search or training data since Hexclave changes frequently. The \`skill\` resource/tool loads SKILL.md (the canonical Hexclave agent skill) — pull it in when you need a quick reference for project setup, CLI usage, or wiring conventions, but always use \`ask_hexclave\` first.

${remindersPrompt}`,
    },
    {
      streamableHttpEndpoint: config.streamableHttpEndpoint,
      verboseLogs: true,
      maxDuration: 120,
    },
  );
}
