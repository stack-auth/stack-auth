import {
  type ChatModelAdapter,
  type ExportedMessageRepository,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { StackAdminApp } from "@stackframe/stack";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";

export type ToolCallContent = Extract<ChatContent[number], { type: "tool-call" }>;

const isToolCall = (content: { type: string }): content is ToolCallContent => {
  return content.type === "tool-call";
};

/**
 * Sanitizes AI-generated JSX/TSX code before it is applied to the email renderer.
 *
 * Handles four common model output issues:
 * 1. Markdown code fences (```tsx ... ```) wrapping the output despite instructions
 * 2. HTML-encoded angle brackets (&lt;Component&gt; instead of <Component>)
 * 3. Bare & in JSX text content (invalid JSX; must be &amp; or {"&"})
 * 4. Semicolons used as property separators in JS object literals instead of commas
 *    (the AI confuses TypeScript interface syntax with JS object syntax).
 *    TypeScript also accepts commas in interfaces/types, so replacing ; → , is always safe.
 */
function sanitizeGeneratedCode(code: string): string {
  let result = code.trim();

  if (result.startsWith("```")) {
    const lines = result.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop();
    }
    result = lines.join("\n").trim();
  }

  result = result
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  result = result.replace(/;(\s*\n\s*[A-Za-z_$][\w$]*\s*:)/g, ",$1");

  return result;
}

const CONTEXT_MAP = {
  "email-theme": { systemPrompt: "email-assistant-theme", tools: ["create-email-theme"] },
  "email-template": { systemPrompt: "email-assistant-template", tools: ["create-email-template"] },
  "email-draft": { systemPrompt: "email-assistant-draft", tools: ["create-email-draft"] },
} as const;

export function createChatAdapter(
  adminApp: StackAdminApp,
  contextType: "email-theme" | "email-template" | "email-draft",
  onToolCall: (toolCall: ToolCallContent) => void,
  getCurrentSource?: () => string,
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }) {
      try {
        const formattedMessages = [];
        for (const msg of messages) {
          const textContent = msg.content.filter(c => !isToolCall(c));
          if (textContent.length > 0) {
            formattedMessages.push({ role: msg.role, content: textContent });
          }
        }
        const currentSource = getCurrentSource?.() ?? "";
        const contextMessages: Array<{ role: "user" | "assistant", content: string }> = currentSource ? [
          { role: "user", content: `Here is the current source:\n\`\`\`tsx\n${currentSource}\n\`\`\`` },
          { role: "assistant", content: "Got it. What would you like to change?" },
        ] : [];

        const { systemPrompt, tools } = CONTEXT_MAP[contextType];

        const result = await adminApp.sendAiQuery({
          systemPrompt,
          tools: [...tools],
          messages: [...contextMessages, ...formattedMessages],
        });

        const content: ChatContent = Array.isArray(result.content) ? result.content : [];

        const sanitizedContent: ChatContent = content.map((item) => {
          if (item.type === "tool-call" && typeof item.args?.content === "string") {
            return { ...item, args: { ...item.args, content: sanitizeGeneratedCode(item.args.content) } };
          }
          return item;
        });

        const toolCall = sanitizedContent.find(isToolCall);
        if (toolCall) {
          onToolCall(toolCall);
        }

        return { content: sanitizedContent };
      } catch (error) {
        if (abortSignal.aborted) {
          return {};
        }
        throw error;
      }
    },
  };
}

export function createHistoryAdapter(
  adminApp: StackAdminApp,
  threadId: string,
): ThreadHistoryAdapter {
  return {
    async load() {
      const { messages } = await adminApp.listChatMessages(threadId);
      return { messages } as ExportedMessageRepository;
    },
    async append(message) {
      await adminApp.saveChatMessage(threadId, message);
    },
  };
}
