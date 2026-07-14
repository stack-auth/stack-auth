"use client";

import { createAnalyticsQueryChatAdapter } from "@/components/vibe-coding";
import { getPublicEnvVar } from "@/lib/env";
import { useLocalThreadRuntime, type AssistantRuntime, type ThreadMessage, type ToolCallContentPart } from "@assistant-ui/react";
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

export type AiQueryChat = {
  runtime: AssistantRuntime,
  messages: readonly ThreadMessage[],
  isResponding: boolean,
  error: Error | null,
  sendMessage: (input: { text: string }) => void,
  clearMessages: () => void,
  stop: () => void,
  latestQuery: string | null,
  queryGeneration: number,
  rewindToQuery: (query: string) => void,
};

export function useAiQueryChat(): AiQueryChat {
  const currentUser = useUser();
  const projectId = useProjectId();
  const backendBaseUrl =
    getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ??
    getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ??
    throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set");

  const [error, setError] = useState<Error | null>(null);

  const adapter = useMemo(
    () => createAnalyticsQueryChatAdapter(
      backendBaseUrl,
      currentUser ?? undefined,
      projectId,
      setError,
    ),
    [backendBaseUrl, currentUser, projectId],
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
  const wasRespondingRef = useRef(false);
  const lastCommittedGenRef = useRef(0);

  useEffect(() => {
    const justFinished = wasRespondingRef.current && !isResponding;
    wasRespondingRef.current = isResponding;
    if (!justFinished) return;

    const latest = extractLatestQuery(messages);
    if (latest == null) return;
    if (latest.toolCallIndex <= lastCommittedGenRef.current) return;
    lastCommittedGenRef.current = latest.toolCallIndex;
    setCommitted({ query: latest.query, generation: latest.toolCallIndex });
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
      runtime.thread.append({
        role: "user",
        content: [{ type: "text", text }],
      });
    },
    [runtime],
  );

  const clearMessages = useCallback(() => {
    setError(null);
    runtime.thread.import({ messages: [], headId: null });
  }, [runtime]);

  const stop = useCallback(() => {
    runtime.thread.cancelRun();
  }, [runtime]);

  const rewindToQuery = useCallback((query: string) => {
    setCommitted((prev) => ({
      query,
      generation: (prev?.generation ?? 0) + 1,
    }));
  }, []);

  return {
    runtime,
    messages,
    isResponding,
    error,
    sendMessage,
    clearMessages,
    stop,
    latestQuery: committed?.query ?? null,
    queryGeneration: committed?.generation ?? 0,
    rewindToQuery,
  };
}
