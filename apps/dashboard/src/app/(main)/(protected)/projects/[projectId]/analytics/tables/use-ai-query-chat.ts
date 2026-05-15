"use client";

import { buildStackAuthHeaders } from "@/lib/api-headers";
import { getPublicEnvVar } from "@/lib/env";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { convertToModelMessages, DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectId } from "../../use-admin-app";

type ToolPart = {
  type: string,
  state: string,
  input?: Record<string, unknown>,
  output?: Record<string, unknown>,
};

function isToolPart(part: unknown): part is ToolPart {
  if (typeof part !== "object" || part === null) return false;
  const typed = part as { type?: unknown };
  return typeof typed.type === "string" && typed.type.startsWith("tool-");
}

function isSuccessfulQueryToolPart(part: ToolPart): boolean {
  if (part.state === "output-error") return false;
  const success = part.output?.success;
  if (success === false) return false;
  return part.state === "output-available";
}

/**
 * Walk backwards through messages / parts and return the most recent
 * `queryAnalytics` tool call. The frontend uses the `query` argument
 * of that call to drive the data grid — the AI is instructed to call
 * the tool any time it wants to commit a new query.
 */
export function extractLatestQuery(messages: UIMessage[]): {
  query: string,
  state: string,
  toolCallIndex: number,
} | null {
  let toolCallIndex = 0;
  // Count total tool calls across the conversation so we can use the
  // index as a stable "generation" key — the dialog uses this to know
  // when the query has been regenerated (for highlight/animation).
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts) {
      if (isToolPart(part) && part.type.endsWith("queryAnalytics")) {
        toolCallIndex += 1;
      }
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j]!;
      if (!isToolPart(part)) continue;
      if (!part.type.endsWith("queryAnalytics")) continue;
      // Wait for a successful tool result before surfacing the query
      // to the grid — otherwise we'd re-run partially streamed or
      // failed SQL on every chunk / failed turn.
      if (!isSuccessfulQueryToolPart(part)) continue;
      const query =
        typeof part.input?.query === "string" ? (part.input.query as string) : null;
      if (query && query.trim().length > 0) {
        return { query, state: part.state, toolCallIndex };
      }
    }
  }
  return null;
}

export type AiQueryChat = ReturnType<typeof useChat> & {
  /**
   * The SQL query the frontend should render in the data grid. Only
   * updates when an assistant turn COMPLETES, so the grid never
   * flashes through intermediate inspection queries — the previously
   * committed query stays visible while the AI is still responding.
   */
  latestQuery: string | null,
  /** Monotonic counter — increments each time a new query is committed. */
  queryGeneration: number,
  /** `true` while the AI is thinking or streaming a response. */
  isResponding: boolean,
  /** Rewind the active query to a specific SQL string from a previous tool call. */
  rewindToQuery: (query: string) => void,
};

/**
 * Shared chat hook for the analytics AI query builder. Sends user
 * messages to the unified AI endpoint with the `build-analytics-query`
 * system prompt and the `sql-query` tool, then extracts the latest
 * committed SQL query so the grid can render its results.
 *
 * Call this ONCE at the top of the tables page and pass the result
 * down to both the search bar and the eye dialog, so they share a
 * single conversation thread.
 */
export function useAiQueryChat(): AiQueryChat {
  const currentUser = useUser();
  const projectId = useProjectId();
  const backendBaseUrl =
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ??
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ??
    throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set");

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${backendBaseUrl}/api/latest/ai/query/stream`,
        headers: () => buildStackAuthHeaders(currentUser),
        prepareSendMessagesRequest: async ({ messages: uiMessages, headers }) => {
          const modelMessages = await convertToModelMessages(uiMessages);
          return {
            body: {
              systemPrompt: "build-analytics-query",
              tools: ["sql-query"],
              quality: "smart",
              speed: "fast",
              projectId,
              messages: modelMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
            },
            headers,
          };
        },
      }),
    // The transport only needs to be rebuilt if the backend URL or
    // project changes; current user is read via closure on each
    // request, so it's not in the dep list on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backendBaseUrl, projectId],
  );

  const chat = useChat({ transport });

  const isResponding = chat.status === "submitted" || chat.status === "streaming";

  // Keep the committed query stable while the AI is still working —
  // the grid should show the previous committed query (if any) until
  // the current turn finishes, so we don't flash intermediate
  // inspection queries into the grid. On turn completion we pick the
  // LAST successful `queryAnalytics` tool call, which the prompt
  // guarantees will be the user-facing final query.
  const [committed, setCommitted] = useState<{
    query: string,
    generation: number,
  } | null>(null);
  const wasRespondingRef = useRef(false);
  const lastCommittedGenRef = useRef(0);

  useEffect(() => {
    const justFinished = wasRespondingRef.current && !isResponding;
    wasRespondingRef.current = isResponding;
    if (!justFinished) return;

    const latest = extractLatestQuery(chat.messages);
    if (latest == null) return;
    if (latest.toolCallIndex <= lastCommittedGenRef.current) return;
    lastCommittedGenRef.current = latest.toolCallIndex;
    setCommitted({ query: latest.query, generation: latest.toolCallIndex });
  }, [isResponding, chat.messages]);

  // When the chat is reset (e.g. setMessages([])) we also clear the
  // committed query so the grid falls back to its default.
  useEffect(() => {
    if (chat.messages.length === 0 && committed != null) {
      lastCommittedGenRef.current = 0;
      setCommitted(null);
    }
  }, [chat.messages.length, committed]);

  const rewindToQuery = useCallback((query: string) => {
    setCommitted((prev) => ({
      query,
      generation: (prev?.generation ?? 0) + 1,
    }));
  }, []);

  return {
    ...chat,
    latestQuery: committed?.query ?? null,
    queryGeneration: committed?.generation ?? 0,
    isResponding,
    rewindToQuery,
  };
}
