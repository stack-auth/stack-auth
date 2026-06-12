import type { selectModel } from "@/lib/ai/models";
import type { Json } from "@hexclave/shared/dist/utils/json";
import type { ModelMessage, ToolSet } from "ai";

export type ContentBlock =
  | { type: "text", text: string }
  | {
      type: "tool-call",
      toolName: string,
      toolCallId: string,
      args: Json,
      argsText: string,
      result: Json,
    };

export type McpCallMetadata = {
  toolName: string,
  reason: string,
  userPrompt: string,
  conversationId?: string | null,
};

export type MessageLike = { role: string, content: unknown };

export type CommonLogFields = {
  correlationId: string,
  mode: "stream" | "generate",
  systemPromptId: string,
  quality: string,
  speed: string,
  modelId: string,
  isAuthenticated: boolean,
  projectId: string | undefined,
  userId: string | undefined,
  requestedToolsJson: string,
  messagesJson: string,
  conversationId: string | undefined,
};

export type ModeContext = {
  model: ReturnType<typeof selectModel>,
  cachedMessages: ModelMessage[],
  toolsArg: ToolSet | undefined,
  stepLimit: number,
  common: CommonLogFields,
  startedAt: number,
};
