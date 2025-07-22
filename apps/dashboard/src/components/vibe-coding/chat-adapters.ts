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

export function createChatAdapter(
  adminApp: StackAdminApp,
  threadId: string,
  contextType: "email-theme" | "email-template",
  onToolCall: (toolCall: ToolCallContent) => void
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }) {
      try {
        const formattedMessages = [];
        for (const msg of messages) {
          formattedMessages.push({
            role: msg.role,
            content: [...msg.content]
          });
          msg.content.filter(isToolCall).forEach(toolCall => {
            formattedMessages.push({
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                result: toolCall.result,
              }],
            });
          });
        }

        const response = await adminApp.sendChatMessage(threadId, contextType, formattedMessages, abortSignal);
        if (response.content.some(isToolCall)) {
          const toolCall = response.content.find(isToolCall);
          if (toolCall) {
            onToolCall(toolCall);
          }
        }
        return {
          content: response.content,
        };
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
