import {
  type ChatModelAdapter,
  type ExportedMessageRepository,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { StackAdminApp } from "@stackframe/stack";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";

const isToolCall = (
  content: { type: string }
): content is Extract<ChatContent[number], { type: "tool-call" }> => {
  return content.type === "tool-call";
};

export function createChatAdapter(
  adminApp: StackAdminApp,
  themeId: string,
  currentEmailTheme: string,
  onToolCall: (toolCallContent: string) => void
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

        const response = await adminApp.sendEmailThemeChatMessage(themeId, currentEmailTheme, formattedMessages, abortSignal);
        if (response.content.some(isToolCall)) {
          const toolCallContent = response.content.find(isToolCall)?.args.content;
          if (toolCallContent) {
            onToolCall(toolCallContent);
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
      const { messages } = await adminApp.listEmailThemeChatMessages(threadId);
      return { messages } as ExportedMessageRepository;
    },
    async append(message) {
      await adminApp.saveEmailThemeChatMessage(threadId, message);
    },
  };
}
