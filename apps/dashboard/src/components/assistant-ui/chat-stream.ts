import { buildStackAuthHeaders, type CurrentUser } from "@/lib/api-headers";
import type { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import {
  convertToModelMessages,
  DefaultChatTransport,
  parseJsonEventStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

type ContentPart = { type: string };
type AttachmentLike = { content?: readonly unknown[] };
type ThreadMessageLikeForBackend = {
  role: string,
  content: readonly ContentPart[],
  attachments?: readonly AttachmentLike[],
};

const isToolCall = (content: ContentPart): boolean => content.type === "tool-call";

/** Maps thread messages to the backend wire format; merges `attachments` into `content`. */
export function formatThreadMessagesForBackend(
  messages: readonly ThreadMessageLikeForBackend[],
): Array<{ role: string, content: unknown }> {
  const formatted: Array<{ role: string, content: unknown }> = [];
  for (const msg of messages) {
    const textContent = msg.content.filter((c) => !isToolCall(c));
    const attachmentContent: unknown[] = [];
    if (msg.attachments) {
      for (const attachment of msg.attachments) {
        if (Array.isArray(attachment.content)) {
          attachmentContent.push(...attachment.content);
        }
      }
    }
    const combined = [...textContent, ...attachmentContent];
    if (combined.length > 0) {
      formatted.push({ role: msg.role, content: combined });
    }
  }
  return formatted;
}

export type AiStreamRequestBody = {
  quality: string,
  speed: string,
  systemPrompt: string,
  tools: string[],
  messages: Array<{ role: string, content: unknown }>,
  projectId?: string,
};

/**
 * Sends a request to the AI streaming endpoint and returns a stream of UIMessageChunks
 * (as produced by the Vercel AI SDK's `streamText().toUIMessageStreamResponse()`).
 */
export async function sendAiStreamRequest(
  backendBaseUrl: string,
  currentUser: CurrentUser | undefined,
  body: AiStreamRequestBody,
  abortSignal?: AbortSignal,
): Promise<ReadableStream<UIMessageChunk>> {
  const authHeaders = await buildStackAuthHeaders(currentUser);

  const response = await fetch(`${backendBaseUrl}/api/latest/ai/query/stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...authHeaders,
    },
    ...(abortSignal ? { signal: abortSignal } : {}),
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI stream request failed: ${response.status} ${response.statusText}`);
  }

  return parseJsonEventStream({
    stream: response.body,
    schema: uiMessageChunkSchema,
  }).pipeThrough(
    new TransformStream<
      { success: true, value: UIMessageChunk, rawValue: unknown } | { success: false, error: unknown, rawValue: unknown },
      UIMessageChunk
    >({
      transform(parseResult, controller) {
        if (parseResult.success) {
          controller.enqueue(parseResult.value);
        }
      },
    }),
  );
}

/**
 * Converts a UIMessage's parts (as emitted by `readUIMessageStream`) into our
 * ChatContent shape — compatible with assistant-ui's `ThreadAssistantContentPart[]`.
 */
export function uiPartsToChatContent(parts: UIMessage["parts"]): ChatContent {
  const result: ChatContent = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text) {
        result.push({ type: "text", text: part.text });
      }
      continue;
    }

    if (part.type === "dynamic-tool") {
      const toolPart = part as { toolCallId: string, toolName: string, input?: unknown, output?: unknown };
      const input = toolPart.input ?? {};
      result.push({
        type: "tool-call",
        toolCallId: toolPart.toolCallId,
        toolName: toolPart.toolName,
        args: input,
        argsText: typeof input === "string" ? input : JSON.stringify(input),
        result: toolPart.output ?? null,
      });
      continue;
    }

    if (typeof part.type === "string" && part.type.startsWith("tool-")) {
      const toolName = part.type.slice("tool-".length);
      const toolPart = part as { toolCallId: string, input?: unknown, output?: unknown };
      const input = toolPart.input ?? {};
      result.push({
        type: "tool-call",
        toolCallId: toolPart.toolCallId,
        toolName,
        args: input,
        argsText: typeof input === "string" ? input : JSON.stringify(input),
        result: toolPart.output ?? null,
      });
      continue;
    }
  }
  return result;
}

export type WireMessage = { role: string, content: unknown };

/**
 * `DefaultChatTransport` configured for the unified `/api/latest/ai/query/stream`
 * endpoint. Shared by `useChat`-style callers (analytics, create-dashboard).
 * `transformMessages` runs after `convertToModelMessages` and can prepend
 * extra context messages.
 */
export function createUnifiedAiTransport(opts: {
  backendBaseUrl: string,
  /** Either a value (closed at creation) or a getter called at request time for liveness. */
  currentUser: CurrentUser | null | (() => CurrentUser | null),
  systemPrompt: string,
  tools: string[],
  quality: "smart" | "fast",
  speed: "fast" | "slow",
  projectId: string | undefined,
  transformMessages?: (messages: WireMessage[]) => Promise<WireMessage[]>,
}): DefaultChatTransport<UIMessage> {
  const resolveUser = () =>
    typeof opts.currentUser === "function" ? opts.currentUser() : opts.currentUser;
  return new DefaultChatTransport<UIMessage>({
    api: `${opts.backendBaseUrl}/api/latest/ai/query/stream`,
    headers: () => buildStackAuthHeaders(resolveUser()),
    prepareSendMessagesRequest: async ({ messages: uiMessages, headers }) => {
      const modelMessages = await convertToModelMessages(uiMessages);
      const userMessages: WireMessage[] = modelMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const finalMessages = opts.transformMessages
        ? await opts.transformMessages(userMessages)
        : userMessages;
      return {
        body: {
          systemPrompt: opts.systemPrompt,
          tools: opts.tools,
          quality: opts.quality,
          speed: opts.speed,
          projectId: opts.projectId,
          messages: finalMessages,
        },
        headers,
      };
    },
  });
}

/**
 * Classifies raw AI provider errors into user-friendly messages.
 * Unclassified errors are reported to Sentry via `captureError`.
 */
export function getFriendlyAiErrorMessage(error: Error): string {
  const causeMessage = (error as { cause?: { message?: string } }).cause?.message ?? "";
  const blob = `${error.message} ${causeMessage}`;
  if (/maximum context length|context_length_exceeded|too many tokens|context length/i.test(blob)) {
    return "The conversation got too long. Try starting a new chat or asking a more focused question.";
  }
  if (/rate limit|429|quota|too many requests/i.test(blob)) {
    return "Service is busy. Please try again in a moment.";
  }
  if (/timeout|ECONNRESET|fetch failed|network/i.test(blob)) {
    return "Request timed out. Please try again.";
  }
  if (/result too large|limit \d+/i.test(blob)) {
    return "The query returned too much data. Try narrowing your question or requesting fewer rows.";
  }
  captureError("ai-chat", error);
  return "Something went wrong. Please try again.";
}
