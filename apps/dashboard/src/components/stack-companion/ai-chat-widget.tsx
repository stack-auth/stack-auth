'use client';

import { cn } from "@/components/ui";
import { createUnifiedAiChatAdapter, getFriendlyAiErrorMessage } from "@/components/assistant-ui/chat-stream";
import { ImageAttachmentAdapter } from "@/components/assistant-ui/image-attachment-adapter";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Thread } from "@/components/assistant-ui/thread";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  replaceConversationMessages,
  type ConversationSummary,
} from "@/lib/ai-conversations";
import { getPublicEnvVar } from "@/lib/env";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadAssistantContentPart,
  type ThreadMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ArrowCounterClockwiseIcon, ArrowLeftIcon, ChatCircleDotsIcon, PlusIcon, SparkleIcon, SpinnerGapIcon, TrashIcon } from "@phosphor-icons/react";
import { useUser } from "@hexclave/next";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type StoredPart = {
  type: string,
  text?: string,
  image?: string,
  toolCallId?: string,
  toolName?: string,
  input?: unknown,
  output?: unknown,
  args?: unknown,
  argsText?: string,
  result?: unknown,
  state?: string,
  isError?: boolean,
};

type StoredMessage = {
  id?: string,
  role: "user" | "assistant" | "system" | "tool",
  content: unknown,
};

type ViewMode =
  | { view: 'list' }
  | { view: 'chat', conversationId: string | null, initialMessages: ThreadMessageLike[] };

type ThreadLikeContentArray = Exclude<ThreadMessageLike["content"], string>;
type ThreadLikeContentPart = ThreadLikeContentArray[number];
type ThreadLikeToolArgs = Extract<ThreadLikeContentPart, { type: "tool-call" }> extends { args?: infer A } ? NonNullable<A> : never;

const RUNNING_STATUS_MESSAGES = ["Thinking..."];

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function convertStoredPartsToThreadContent(rawParts: unknown): ThreadLikeContentPart[] {
  if (!Array.isArray(rawParts)) return [];
  const result: ThreadLikeContentPart[] = [];
  for (const candidate of rawParts as unknown[]) {
    if (!candidate || typeof candidate !== "object") continue;
    const raw = candidate as StoredPart;
    if (typeof raw.type !== "string") continue;

    if (raw.type === "text" && typeof raw.text === "string") {
      result.push({ type: "text", text: raw.text });
      continue;
    }

    if (raw.type === "image" && typeof raw.image === "string") {
      result.push({ type: "image", image: raw.image });
      continue;
    }

    if (raw.type === "tool-call") {
      const args = ((raw.args ?? raw.input ?? {}) as unknown) as ThreadLikeToolArgs;
      result.push({
        type: "tool-call",
        toolCallId: raw.toolCallId ?? crypto.randomUUID(),
        toolName: raw.toolName ?? "tool",
        args,
        argsText: raw.argsText ?? (typeof (raw.args ?? raw.input) === "string"
          ? String(raw.args ?? raw.input)
          : JSON.stringify(raw.args ?? raw.input ?? {})),
        result: raw.result ?? raw.output,
        isError: raw.isError ?? raw.state === "output-error",
      });
      continue;
    }

    if (raw.type === "dynamic-tool" || raw.type.startsWith("tool-")) {
      const toolName = raw.type === "dynamic-tool"
        ? (raw.toolName ?? "tool")
        : raw.type.slice("tool-".length);
      const rawInput = raw.input ?? raw.args ?? {};
      const args = ((typeof rawInput === "object" ? rawInput : {}) as unknown) as ThreadLikeToolArgs;
      result.push({
        type: "tool-call",
        toolCallId: raw.toolCallId ?? crypto.randomUUID(),
        toolName,
        args,
        argsText: typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput),
        result: raw.output ?? raw.result,
        isError: raw.state === "output-error" || raw.isError,
      });
      continue;
    }
  }
  return result;
}

function storedMessagesToThreadMessages(stored: readonly StoredMessage[]): ThreadMessageLike[] {
  const out: ThreadMessageLike[] = [];
  for (const m of stored) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = convertStoredPartsToThreadContent(m.content);
    if (content.length === 0) continue;
    out.push({
      id: m.id,
      role: m.role,
      content,
    });
  }
  return out;
}

function getMessageText(message: ThreadMessage | ThreadMessageLike): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map(p => p.type === "text" ? p.text : "")
    .join("");
}

function ConversationList({
  projectId,
  onSelectConversation,
  onNewChat,
}: {
  projectId: string | undefined,
  onSelectConversation: (id: string) => void,
  onNewChat: () => void,
}) {
  const currentUser = useUser();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !currentUser) {
      setLoading(false);
      return;
    }
    runAsynchronouslyWithAlert(async () => {
      try {
        const result = await listConversations(currentUser, projectId);
        setConversations(result);
      } finally {
        setLoading(false);
      }
    });
  }, [currentUser, projectId]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    runAsynchronouslyWithAlert(async () => {
      try {
        await deleteConversation(currentUser, id);
        setConversations(prev => prev.filter(c => c.id !== id));
      } finally {
        setDeletingId(null);
      }
    });
  }, [currentUser]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/[0.05]">
          <span className="text-xs font-medium text-muted-foreground">Chat History</span>
          <button
            onClick={onNewChat}
            className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
            type="button"
          >
            <PlusIcon className="h-3 w-3" />
            <span>New Chat</span>
          </button>
        </div>
        <div className="flex-1 px-3 py-2 space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-foreground/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-foreground/[0.05]">
        <span className="text-xs font-medium text-muted-foreground">Chat History</span>
        <button
          onClick={onNewChat}
          className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
          type="button"
        >
          <PlusIcon className="h-3 w-3" />
          <span>New Chat</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <ChatCircleDotsIcon className="h-8 w-8 text-muted-foreground/30" />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground/60">No conversations yet</p>
              <button
                onClick={onNewChat}
                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
                type="button"
              >
                Start a new chat
              </button>
            </div>
          </div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-foreground/[0.04] transition-colors group flex items-start gap-2 cursor-pointer"
            >
              <SparkleIcon className="h-3.5 w-3.5 text-purple-400/60 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-foreground truncate">
                  {conv.title.length > 40 ? `${conv.title.slice(0, 40)}...` : conv.title}
                </p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                  {formatRelativeTime(conv.updatedAt)}
                </p>
              </div>
              <button
                onClick={(e) => handleDelete(e, conv.id)}
                disabled={deletingId === conv.id}
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/40 hover:text-red-400 transition-all shrink-0"
                type="button"
                aria-label="Delete conversation"
                title="Delete conversation"
              >
                {deletingId === conv.id ? (
                  <SpinnerGapIcon className="h-3 w-3 animate-spin" />
                ) : (
                  <TrashIcon className="h-3 w-3" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function AIChatWidget() {
  const currentUser = useUser();
  const pathname = usePathname();
  const projectId = pathname.startsWith("/projects/") ? pathname.split("/")[2] : undefined;
  const [viewMode, setViewMode] = useState<ViewMode>({ view: 'chat', conversationId: null, initialMessages: [] });
  const [conversationKey, setConversationKey] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const didLoadRef = useRef(false);

  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;

    if (!projectId) {
      setInitialLoading(false);
      return;
    }
    runAsynchronouslyWithAlert(async () => {
      try {
        const conversations = await listConversations(currentUser, projectId);
        if (conversations.length > 0) {
          const conv = await getConversation(currentUser, conversations[0].id);
          const initialMessages = storedMessagesToThreadMessages(conv.messages as StoredMessage[]);
          setViewMode({ view: 'chat', conversationId: conversations[0].id, initialMessages });
          setConversationKey(prev => prev + 1);
        }
      } finally {
        setInitialLoading(false);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only load on mount
  }, []);

  const handleSelectConversation = useCallback(async (id: string) => {
    const conv = await getConversation(currentUser, id);
    const initialMessages = storedMessagesToThreadMessages(conv.messages as StoredMessage[]);
    setConversationKey(prev => prev + 1);
    setViewMode({ view: 'chat', conversationId: id, initialMessages });
  }, [currentUser]);

  const handleNewChat = useCallback(() => {
    setConversationKey(prev => prev + 1);
    setViewMode({ view: 'chat', conversationId: null, initialMessages: [] });
  }, []);

  const handleBackToList = useCallback(() => {
    setViewMode({ view: 'list' });
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setViewMode(prev => {
      if (prev.view === 'chat') {
        return { ...prev, conversationId: id };
      }
      return prev;
    });
  }, []);

  if (initialLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <SpinnerGapIcon className="h-5 w-5 text-purple-400 animate-spin" />
        <span className="text-xs text-muted-foreground/60">Loading conversations...</span>
      </div>
    );
  }

  if (viewMode.view === 'list') {
    return (
      <ConversationList
        projectId={projectId}
        onSelectConversation={(id) => runAsynchronouslyWithAlert(handleSelectConversation(id))}
        onNewChat={handleNewChat}
      />
    );
  }

  return (
    <AIChatWidgetInner
      key={conversationKey}
      projectId={projectId}
      conversationId={viewMode.conversationId}
      initialMessages={viewMode.initialMessages}
      onConversationCreated={handleConversationCreated}
      onBackToList={handleBackToList}
      onNewChat={handleNewChat}
    />
  );
}

function AIChatWidgetInner({
  projectId,
  conversationId: initialConversationId,
  initialMessages,
  onConversationCreated,
  onBackToList,
  onNewChat,
}: {
  projectId: string | undefined,
  conversationId: string | null,
  initialMessages: ThreadMessageLike[],
  onConversationCreated: (id: string) => void,
  onBackToList: () => void,
  onNewChat: () => void,
}) {
  const currentUser = useUser();
  const conversationIdRef = useRef(initialConversationId);
  const isSavingRef = useRef(false);
  const pendingMessagesRef = useRef<{ messages: Array<{ role: string, content: unknown }>, title: string } | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const backendBaseUrl = getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL")
    ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL")
    ?? throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set");

  const doSave = useCallback(async (messagesToSave: Array<{ role: string, content: unknown }>, title: string) => {
    isSavingRef.current = true;
    try {
      if (conversationIdRef.current) {
        await replaceConversationMessages(currentUser, conversationIdRef.current, messagesToSave);
      } else if (projectId) {
        const result = await createConversation(currentUser, {
          title,
          projectId,
          messages: messagesToSave,
        });
        conversationIdRef.current = result.id;
        onConversationCreated(result.id);
      }
    } finally {
      isSavingRef.current = false;
      const pending = pendingMessagesRef.current;
      pendingMessagesRef.current = null;
      if (pending) {
        await doSave(pending.messages, pending.title);
      }
    }
  }, [currentUser, projectId, onConversationCreated]);

  const persist = useCallback((priorMessages: readonly ThreadMessage[], finalAssistantContent: ThreadAssistantContentPart[]) => {
    const allWire: Array<{ role: string, content: unknown }> = priorMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    if (finalAssistantContent.length > 0) {
      allWire.push({ role: "assistant", content: finalAssistantContent });
    }

    const firstUserMessage = priorMessages.find(m => m.role === "user");
    const title = firstUserMessage
      ? getMessageText(firstUserMessage).slice(0, 50) || "New conversation"
      : "New conversation";

    if (isSavingRef.current) {
      pendingMessagesRef.current = { messages: allWire, title };
      return;
    }
    runAsynchronouslyWithAlert(doSave(allWire, title));
  }, [doSave]);

  const chatAdapter = useMemo<ChatModelAdapter>(() => createUnifiedAiChatAdapter({
    backendBaseUrl,
    currentUser: currentUser ?? undefined,
    systemPrompt: "command-center-ask-ai",
    tools: ["docs", "sql-query"],
    quality: "smart",
    speed: "slow",
    projectId,
    onRunStart: () => {
      setRunError(null);
      setIsRunning(true);
    },
    onRunEnd: () => setIsRunning(false),
    onFinish: ({ threadMessages, assistantContent }) => {
      persist(threadMessages, assistantContent as ThreadAssistantContentPart[]);
    },
    onError: ({ error, threadMessages }) => {
      setRunError(getFriendlyAiErrorMessage(error));
      persist(threadMessages.filter(m => m.role === "user"), []);
    },
  }), [backendBaseUrl, currentUser, projectId, persist]);

  const attachmentAdapter = useMemo(() => new ImageAttachmentAdapter(), []);

  const runtime = useLocalRuntime(chatAdapter, {
    initialMessages,
    adapters: { attachments: attachmentAdapter },
  });

  const assistantContentComponents = useMemo(() => ({
    Text: MarkdownText,
    tools: { Fallback: ToolFallback },
  }), []);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full">
        <div className="px-3 py-2 border-b border-black/[0.06] dark:border-foreground/[0.06] bg-white dark:bg-background/40 flex items-center justify-between shrink-0">
          <button
            onClick={onBackToList}
            disabled={isRunning}
            className={cn(
              "flex items-center gap-1 text-[11px] transition-colors",
              isRunning
                ? "text-muted-foreground/25 cursor-not-allowed"
                : "text-muted-foreground/60 hover:text-muted-foreground",
            )}
            type="button"
          >
            <ArrowLeftIcon className="h-3 w-3" />
            <span>Back to history</span>
          </button>
          <button
            onClick={onNewChat}
            disabled={isRunning}
            className={cn(
              "flex items-center gap-1 text-[11px] transition-colors",
              isRunning
                ? "text-muted-foreground/25 cursor-not-allowed"
                : "text-muted-foreground/60 hover:text-muted-foreground",
            )}
            type="button"
          >
            <ArrowCounterClockwiseIcon className="h-3 w-3" />
            <span>New conversation</span>
          </button>
        </div>

        {runError && (
          <div className="mx-3 mt-2 flex items-start gap-2 text-[12px] text-red-400/90 px-3 py-2 bg-red-500/[0.08] rounded-lg ring-1 ring-red-500/20 shrink-0">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>{runError}</span>
          </div>
        )}

        <Thread
          composerPlaceholder="Ask a question..."
          runningStatusMessages={RUNNING_STATUS_MESSAGES}
          assistantContentComponents={assistantContentComponents}
          welcome={<AskAiWelcome />}
          composerAttachments
          attachmentAdapter={attachmentAdapter}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}

function AskAiWelcome() {
  return (
    <div className="flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
      <div className="flex w-full flex-grow flex-col items-center justify-center py-16 px-6">
        <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center mb-4 ring-1 ring-purple-500/20">
          <SparkleIcon className="w-6 h-6 text-purple-400" weight="duotone" />
        </div>
        <h2 className="text-base font-semibold tracking-tight text-foreground mb-1.5">
          Ask AI
        </h2>
        <p className="text-xs text-muted-foreground text-center max-w-[260px] leading-relaxed">
          Get AI-powered answers about Hexclave, your project, and analytics.
        </p>
      </div>
    </div>
  );
}

