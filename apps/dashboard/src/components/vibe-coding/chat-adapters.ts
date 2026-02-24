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

const CONTEXT_MAP = {
  "email-theme": { systemPrompt: "email-assistant-theme", tools: ["create-email-theme"] },
  "email-template": { systemPrompt: "email-assistant-template", tools: ["create-email-template"] },
  "email-draft": { systemPrompt: "email-assistant-draft", tools: ["create-email-draft"] },
} as const;

export function createChatAdapter(
  projectId: string,
  threadId: string,
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

        const response = await fetch("/api/email-ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId,
            systemPrompt,
            tools: [...tools],
            messages: [...contextMessages, ...formattedMessages],
          }),
          signal: abortSignal,
        });

        if (!response.ok) {
          throw new Error(`AI request failed: ${response.status}`);
        }

        const result = await response.json() as { content?: ChatContent };
        const content: ChatContent = Array.isArray(result.content) ? result.content : [];

        const toolCall = content.find(isToolCall);
        if (toolCall) {
          onToolCall(toolCall);
        }

        return { content };
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
