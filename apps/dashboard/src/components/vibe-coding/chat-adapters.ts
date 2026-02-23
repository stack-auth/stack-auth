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
  contextType: "email-theme" | "email-template" | "email-draft" | "custom-dashboard",
  onToolCall: (toolCall: ToolCallContent) => void
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }) {
      try {
        const formattedMessages = [];
        for (const msg of messages) {
          // Separate tool calls from other content
          const toolCalls = msg.content.filter(isToolCall);
          const nonToolContent = msg.content.filter(c => !isToolCall(c));
          // Only add the message if it has non-tool content
          if (nonToolContent.length > 0) {
            formattedMessages.push({
              role: msg.role,
              content: nonToolContent
            });
          }
          // Add tool results as separate messages
          toolCalls.forEach(toolCall => {
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

export function createDashboardChatAdapter(
  currentSource: string,
  onToolCall: (toolCall: ToolCallContent) => void
): ChatModelAdapter {
  return {
    async run({ messages, abortSignal }) {
      try {
        // #region agent log
        fetch('http://127.0.0.1:7841/ingest/aa26d43e-f389-4800-9dd3-007c998e5125',{ method: 'POST',headers: { 'Content-Type': 'application/json','X-Debug-Session-Id': '9b8b82' },body: JSON.stringify({ sessionId: '9b8b82',location: 'chat-adapters.ts:run-entry',message: 'adapter run called',data: { messageCount: messages.length,roles: messages.map(m=>m.role),toolCallsPerMsg: messages.map(m=>m.content.filter(isToolCall).map(tc=>({ toolName: tc.toolName,toolCallId: tc.toolCallId,hasResult: tc.result!==undefined,result: tc.result }))),hypothesisId: 'H-A,H-D' },timestamp: Date.now() }) }).catch(()=>{});
        // #endregion

        const formattedMessages = [];
        for (const msg of messages) {
          const toolCalls = msg.content.filter(isToolCall);

          formattedMessages.push({
            role: msg.role,
            content: msg.content,
          });

          if (toolCalls.length > 0) {
            formattedMessages.push({
              role: "tool",
              content: toolCalls.map(tc => ({
                type: "tool-result",
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                result: tc.result,
              })),
            });
          }
        }

        // #region agent log
        fetch('http://127.0.0.1:7841/ingest/aa26d43e-f389-4800-9dd3-007c998e5125',{ method: 'POST',headers: { 'Content-Type': 'application/json','X-Debug-Session-Id': '9b8b82' },body: JSON.stringify({ sessionId: '9b8b82',location: 'chat-adapters.ts:pre-fetch',message: 'formatted messages to send',data: { formattedCount: formattedMessages.length,formattedRoles: formattedMessages.map(m=>m.role),formattedContent: formattedMessages.map(m=>JSON.stringify(m.content).slice(0,300)),hypothesisId: 'H-B,H-C' },timestamp: Date.now() }) }).catch(()=>{});
        // #endregion

        const response = await fetch("/api/dashboard-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: formattedMessages,
            currentSource,
          }),
          signal: abortSignal,
        });

        // #region agent log
        fetch('http://127.0.0.1:7841/ingest/aa26d43e-f389-4800-9dd3-007c998e5125',{ method: 'POST',headers: { 'Content-Type': 'application/json','X-Debug-Session-Id': '9b8b82' },body: JSON.stringify({ sessionId: '9b8b82',location: 'chat-adapters.ts:post-fetch',message: 'API response status',data: { status: response.status,ok: response.ok,statusText: response.statusText,hypothesisId: 'H-C' },timestamp: Date.now() }) }).catch(()=>{});
        // #endregion

        if (!response.ok) {
          const errorText = await response.text().catch(() => "(could not read body)");
          // #region agent log
          fetch('http://127.0.0.1:7841/ingest/aa26d43e-f389-4800-9dd3-007c998e5125',{ method: 'POST',headers: { 'Content-Type': 'application/json','X-Debug-Session-Id': '9b8b82' },body: JSON.stringify({ sessionId: '9b8b82',location: 'chat-adapters.ts:error-body',message: 'API error response body',data: { status: response.status,errorText: errorText.slice(0,1000),hypothesisId: 'H-C' },timestamp: Date.now() }) }).catch(()=>{});
          // #endregion
          throw new Error(`Dashboard chat request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.content as ChatContent;

        if (content.some(isToolCall)) {
          const toolCall = content.find(isToolCall);
          if (toolCall) {
            onToolCall(toolCall);
          }
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
