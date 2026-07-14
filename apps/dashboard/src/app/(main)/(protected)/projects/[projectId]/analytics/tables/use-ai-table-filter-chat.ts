"use client";

import { createAnalyticsTableFilterChatAdapter } from "@/components/vibe-coding";
import { getPublicEnvVar } from "@/lib/env";
import { useLocalThreadRuntime, type ThreadMessage, type ToolCallContentPart } from "@assistant-ui/react";
import { useUser } from "@hexclave/next";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProjectId } from "../../use-admin-app";

const QUERY_ANALYTICS_TOOL = "queryAnalytics";

type QueryToolPart = ToolCallContentPart<{ query?: string }, unknown>;

function isQueryAnalyticsToolPart(
  part: ThreadMessage["content"][number],
): part is QueryToolPart {
  return part.type === "tool-call" && part.toolName === QUERY_ANALYTICS_TOOL;
}

function isSuccessfulQueryToolPart(part: QueryToolPart): boolean {
  if (part.result == null) return false;
  if (
    typeof part.result === "object"
    && "success" in part.result
    && Reflect.get(part.result, "success") === false
  ) {
    return false;
  }
  return true;
}

export function extractLatestQuery(messages: readonly ThreadMessage[]): {
  query: string,
  toolCallIndex: number,
} | null {
  let toolCallIndex = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.content) {
      if (isQueryAnalyticsToolPart(part)) toolCallIndex += 1;
    }
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j]!;
      if (!isQueryAnalyticsToolPart(part)) continue;
      if (!isSuccessfulQueryToolPart(part)) continue;
      const query = typeof part.args.query === "string" ? part.args.query : null;
      if (query && query.trim().length > 0) {
        return { query, toolCallIndex };
      }
    }
  }
  return null;
}

/**
 * Extracts the trailing text of the last assistant message, so the UI can
 * surface what the AI said when it answered without committing a query
 * (e.g. "that's an aggregation, which this search can't display").
 */
function extractLastAssistantText(messages: readonly ThreadMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.role !== "assistant") continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const part = msg.content[j]!;
      if (part.type === "text" && part.text.trim().length > 0) {
        return part.text.trim();
      }
    }
  }
  return null;
}

export type AiTableFilterChat = {
  messages: readonly ThreadMessage[],
  isResponding: boolean,
  error: Error | null,
  sendMessage: (input: { text: string }) => void,
  clearMessages: () => void,
  /** The last query the AI committed via the queryAnalytics tool (unvalidated). */
  latestQuery: string | null,
  /**
   * Set when the last run finished WITHOUT committing a new query — holds the
   * assistant's text reply (or null if there was none / a query was
   * committed). Cleared on the next send/clear or via `dismissAssistantNote`.
   */
  assistantNote: string | null,
  dismissAssistantNote: () => void,
};

/**
 * AI chat thread backing the analytics table search bar's AI fallback. Uses
 * the constrained `filter-analytics-table` system prompt scoped to the given
 * table, so the AI only produces `SELECT * FROM <table> WHERE ...` row
 * filters (callers still validate the shape before applying — see
 * `getValidatedTableFilterQuery`).
 */
export function useAiTableFilterChat(tableName: string): AiTableFilterChat {
  const currentUser = useUser();
  const projectId = useProjectId();
  const backendBaseUrl =
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ??
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ??
    throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set");

  const [error, setError] = useState<Error | null>(null);

  const adapter = useMemo(
    () => createAnalyticsTableFilterChatAdapter(
      backendBaseUrl,
      currentUser ?? undefined,
      projectId,
      tableName,
      setError,
    ),
    [backendBaseUrl, currentUser, projectId, tableName],
  );

  const runtime = useLocalThreadRuntime(adapter, { maxSteps: 1 });

  const [snapshot, setSnapshot] = useState(() => {
    const s = runtime.thread.getState();
    return { messages: s.messages, isRunning: s.isRunning };
  });
  useEffect(() => {
    const update = () => {
      const s = runtime.thread.getState();
      setSnapshot((prev) =>
        prev.messages === s.messages && prev.isRunning === s.isRunning
          ? prev
          : { messages: s.messages, isRunning: s.isRunning },
      );
    };
    const unsub = runtime.thread.subscribe(update);
    update();
    return unsub;
  }, [runtime]);

  const isResponding = snapshot.isRunning;
  const messages = snapshot.messages;

  const [committed, setCommitted] = useState<{
    query: string,
    generation: number,
  } | null>(null);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);
  const wasRespondingRef = useRef(false);
  const lastCommittedGenRef = useRef(0);

  useEffect(() => {
    const justFinished = wasRespondingRef.current && !isResponding;
    wasRespondingRef.current = isResponding;
    if (!justFinished) return;

    const latest = extractLatestQuery(messages);
    if (latest == null || latest.toolCallIndex <= lastCommittedGenRef.current) {
      // The run ended without committing a new query — surface the
      // assistant's text (if any) so callers can show WHY nothing changed.
      // This must live here (not in a consuming component) because child
      // effects run before this one; a child comparing commit state on the
      // same falling edge would race the commit below.
      setAssistantNote(extractLastAssistantText(messages));
      return;
    }
    lastCommittedGenRef.current = latest.toolCallIndex;
    setCommitted({ query: latest.query, generation: latest.toolCallIndex });
    setAssistantNote(null);
  }, [isResponding, messages]);

  useEffect(() => {
    if (messages.length === 0 && committed != null) {
      lastCommittedGenRef.current = 0;
      setCommitted(null);
    }
  }, [messages.length, committed]);

  const sendMessage = useCallback(
    ({ text }: { text: string }) => {
      setError(null);
      setAssistantNote(null);
      runtime.thread.append({
        role: "user",
        content: [{ type: "text", text }],
      });
    },
    [runtime],
  );

  const clearMessages = useCallback(() => {
    setError(null);
    setAssistantNote(null);
    runtime.thread.import({ messages: [], headId: null });
  }, [runtime]);

  const dismissAssistantNote = useCallback(() => {
    setAssistantNote(null);
  }, []);

  return {
    messages,
    isResponding,
    error,
    sendMessage,
    clearMessages,
    latestQuery: committed?.query ?? null,
    assistantNote,
    dismissAssistantNote,
  };
}
