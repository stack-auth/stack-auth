'use client';

import { cn } from "@/components/ui";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  replaceConversationMessages,
  type ConversationSummary,
} from "@/lib/ai-conversations";
import { buildStackAuthHeaders } from "@/lib/api-headers";
import { getPublicEnvVar } from "@/lib/env";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { ArrowCounterClockwiseIcon, ArrowLeftIcon, ChatCircleDotsIcon, PaperPlaneTiltIcon, PlusIcon, SparkleIcon, SpinnerGapIcon, TrashIcon } from "@phosphor-icons/react";
import { useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { convertToModelMessages, DefaultChatTransport } from "ai";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantMessage,
  getMessageContent,
  getToolInvocations,
  UserMessage,
  useWordStreaming,
} from "../commands/ai-chat-shared";

type ViewMode =
  | { view: 'list' }
  | { view: 'chat', conversationId: string | null, initialMessages: UIMessage[] };

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
          const initialMessages: UIMessage[] = conv.messages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            parts: msg.content as UIMessage["parts"],
          }));
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
    const initialMessages: UIMessage[] = conv.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: msg.content as UIMessage["parts"],
    }));
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
  initialMessages: UIMessage[],
  onConversationCreated: (id: string) => void,
  onBackToList: () => void,
  onNewChat: () => void,
}) {
  const [followUpInput, setFollowUpInput] = useState("");
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const currentUser = useUser();
  const conversationIdRef = useRef(initialConversationId);
  const prevStatusRef = useRef<string>("");
  const isSavingRef = useRef(false);
  const pendingMessagesRef = useRef<{ messages: Array<{ role: string; content: unknown }>; title: string } | null>(null);

  const backendBaseUrl = getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set");

  const hasInitialMessages = initialMessages.length > 0;
  const [input, setInput] = useState("");
  const [conversationStarted, setConversationStarted] = useState(hasInitialMessages);

  const {
    messages,
    status,
    sendMessage,
    error: aiError,
  } = useChat({
    messages: hasInitialMessages ? initialMessages : undefined,
    transport: new DefaultChatTransport({
      api: `${backendBaseUrl}/api/latest/ai/query/stream`,
      headers: () => buildStackAuthHeaders(currentUser),
      prepareSendMessagesRequest: async ({ messages: uiMessages, headers }) => {
        const modelMessages = await convertToModelMessages(uiMessages);
        return {
          body: {
            systemPrompt: "command-center-ask-ai",
            tools: ["docs", "sql-query"],
            quality: "smart",
            speed: "slow",
            projectId,
            messages: modelMessages.map(m => ({
              role: m.role,
              content: m.content,
            })),
          },
          headers,
        };
      },
    }),
  });

  const aiLoading = status === "submitted" || status === "streaming";

  const doSave = useCallback(async (messagesToSave: Array<{ role: string; content: unknown }>, title: string) => {
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

  // Save conversation when streaming completes
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    const completedOk = (prevStatus === "streaming" || prevStatus === "submitted") && status === "ready";
    const completedWithError = (prevStatus === "streaming" || prevStatus === "submitted") && status === "error";

    if (
      (completedOk || completedWithError) &&
      messages.length > 0
    ) {
      // On error, only save user messages (strip any partial/failed assistant turn)
      const safeMessages = completedWithError
        ? messages.filter(m => m.role === "user")
        : messages;
      if (safeMessages.length === 0) return;

      const messagesToSave = safeMessages.map(m => ({
        role: m.role,
        content: m.parts,
      }));
      const firstUserMessage = messages.find(m => m.role === "user");
      const title = firstUserMessage
        ? getMessageContent(firstUserMessage).slice(0, 50) || "New conversation"
        : "New conversation";

      if (isSavingRef.current) {
        pendingMessagesRef.current = { messages: messagesToSave, title };
        return;
      }

      runAsynchronouslyWithAlert(doSave(messagesToSave, title));
    }
  }, [status, messages, doSave]);

  // Word streaming for the last assistant message
  const lastAssistantMessage = messages.slice().reverse().find((m: UIMessage) => m.role === "assistant");
  const lastAssistantContent = lastAssistantMessage ? getMessageContent(lastAssistantMessage) : "";
  const { displayedWordCount, getDisplayContent, isRevealing } = useWordStreaming(lastAssistantContent);
  const isStreaming = aiLoading && lastAssistantMessage;

  // Auto-focus input on mount
  useEffect(() => {
    if (!conversationStarted) {
      inputRef.current?.focus();
    } else {
      followUpInputRef.current?.focus();
    }
  }, [conversationStarted]);

  // Track if user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Auto-scroll when new messages are added or when already at bottom
  useEffect(() => {
    if (!messagesContainerRef.current) return;

    const container = messagesContainerRef.current;
    const messageCount = messages.length;

    if (messageCount > lastMessageCountRef.current) {
      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
    } else if (aiLoading && isNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }

    lastMessageCountRef.current = messageCount;
  }, [messages, aiLoading]);

  // Handle initial question submit
  const handleSubmit = useCallback(() => {
    if (!input.trim() || aiLoading) return;
    setConversationStarted(true);
    runAsynchronously(sendMessage({ text: input.trim() }));
    setInput("");
    requestAnimationFrame(() => {
      followUpInputRef.current?.focus();
    });
  }, [input, aiLoading, sendMessage]);

  // Handle initial input keyboard
  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  // Handle follow-up questions
  const handleFollowUp = useCallback(() => {
    const text = followUpInput.trim();
    if (!text || aiLoading) return;
    setFollowUpInput("");
    runAsynchronously(sendMessage({ text }));
    requestAnimationFrame(() => {
      followUpInputRef.current?.focus();
    });
  }, [followUpInput, sendMessage, aiLoading]);

  // Handle follow-up input keyboard
  const handleFollowUpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        handleFollowUp();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        const container = messagesContainerRef.current;
        if (container) {
          const scrollAmount = e.key === "ArrowUp" ? -100 : 100;
          container.scrollBy({ top: scrollAmount, behavior: "smooth" });
        }
      }
    },
    [handleFollowUp]
  );

  // Determine what to show in the loading state
  const showLoadingIndicator = conversationStarted && (messages.length === 0 || (aiLoading && !messages.some((m: UIMessage) => m.role === "assistant" && getMessageContent(m))));

  // Initial state - show input
  if (!conversationStarted) {
    return (
      <div className="flex flex-col h-full">
        {/* Back button */}
        <div className="px-3 py-2 border-b border-foreground/[0.05]">
          <button
            onClick={onBackToList}
            className="flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            type="button"
          >
            <ArrowLeftIcon className="h-3 w-3" />
            <span>Back to history</span>
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-4">
          <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
            <SparkleIcon className="h-5 w-5 text-purple-400" />
          </div>
          <div className="text-center space-y-1.5">
            <h3 className="text-sm font-semibold text-foreground">Ask AI</h3>
            <p className="text-xs text-muted-foreground/70 max-w-[240px]">
              Get AI-powered answers about Stack Auth, your project, and analytics
            </p>
          </div>
        </div>

        <div className="shrink-0 border-t border-foreground/[0.05] px-3.5 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-1.5 ring-1 ring-foreground/[0.05] focus-within:ring-purple-500/25 transition-shadow">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleInputKeyDown}
              aria-label="Initial prompt"
              placeholder="Ask a question..."
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || aiLoading}
              aria-label="Send message"
              title="Send message"
              className={cn(
                "p-1 rounded transition-colors hover:transition-none",
                input.trim() && !aiLoading
                  ? "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                  : "text-muted-foreground/25 cursor-not-allowed"
              )}
              type="button"
            >
              <PaperPlaneTiltIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground/40 mt-1.5 text-center">
            Enter to send
          </p>
        </div>
      </div>
    );
  }

  // Conversation view
  return (
    <div className="flex flex-col h-full">
      {/* Back button */}
      <div className="px-3 py-2 border-b border-foreground/[0.05] flex items-center justify-between">
        <button
          onClick={onBackToList}
          disabled={aiLoading}
          className={cn(
            "flex items-center gap-1 text-[11px] transition-colors",
            aiLoading
              ? "text-muted-foreground/25 cursor-not-allowed"
              : "text-muted-foreground/60 hover:text-muted-foreground"
          )}
          type="button"
        >
          <ArrowLeftIcon className="h-3 w-3" />
          <span>Back to history</span>
        </button>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {messages.map((message: UIMessage, index: number, arr: UIMessage[]) => {
          const messageContent = getMessageContent(message);
          const toolInvocations = message.role === "assistant" ? getToolInvocations(message) : [];

          // For the last assistant message, apply word-by-word streaming
          const isLastAssistant = message.role === "assistant" &&
            index === arr.length - 1 - (arr[arr.length - 1]?.role === "user" ? 1 : 0);
          const displayContent = message.role === "assistant" && isLastAssistant && aiLoading
            ? getDisplayContent(messageContent)
            : messageContent;

          // Don't render if no content to show yet AND no tool invocations
          if (message.role === "assistant" && isLastAssistant && !displayContent && toolInvocations.length === 0) {
            return null;
          }

          if (message.role === "user") {
            return <UserMessage key={message.id || index} content={messageContent} />;
          }
          return (
            <AssistantMessage
              key={message.id || index}
              content={displayContent}
              toolInvocations={toolInvocations}
            />
          );
        })}

        {/* Loading indicator */}
        {showLoadingIndicator && (
          <div className="flex gap-2.5 justify-start">
            <div className="shrink-0 w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center">
              <SparkleIcon className="h-3 w-3 text-purple-400" />
            </div>
            <div className="bg-foreground/[0.02] rounded-xl px-3.5 py-2">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming indicator */}
        {isStreaming && displayedWordCount > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50 pl-8">
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-purple-400/60 animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-1 h-1 rounded-full bg-purple-400/60 animate-pulse" style={{ animationDelay: "300ms" }} />
            </span>
          </div>
        )}

        {/* Error display */}
        {aiError && (
          <div className="flex items-start gap-2 text-[12px] text-red-400/90 px-3 py-2 bg-red-500/[0.08] rounded-lg ring-1 ring-red-500/20">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>{aiError.message || "Failed to get response. Please try again."}</span>
          </div>
        )}
      </div>

      {/* Follow-up input + new conversation button */}
      <div className="shrink-0 border-t border-foreground/[0.05] px-3.5 py-2.5">
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-1.5 ring-1 ring-foreground/[0.05] focus-within:ring-purple-500/25 transition-shadow">
          <input
            ref={followUpInputRef}
            type="text"
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            onKeyDown={handleFollowUpKeyDown}
            aria-label="Follow-up question"
            placeholder="Ask a follow-up question..."
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            onClick={() => handleFollowUp()}
            disabled={!followUpInput.trim() || aiLoading}
            aria-label="Send message"
            title="Send message"
            className={cn(
              "p-1 rounded transition-colors hover:transition-none",
              followUpInput.trim() && !aiLoading
                ? "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                : "text-muted-foreground/25 cursor-not-allowed"
            )}
            type="button"
          >
            <PaperPlaneTiltIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-center justify-between mt-1.5">
          <button
            onClick={onNewChat}
            disabled={aiLoading}
            className={cn(
              "flex items-center gap-1 text-[9px] transition-colors hover:transition-none",
              aiLoading
                ? "text-muted-foreground/25 cursor-not-allowed"
                : "text-muted-foreground/40 hover:text-muted-foreground/70"
            )}
            type="button"
          >
            <ArrowCounterClockwiseIcon className="h-2.5 w-2.5" />
            <span>New conversation</span>
          </button>
          <p className="text-[9px] text-muted-foreground/40">
            Enter to send
          </p>
        </div>
      </div>
    </div>
  );
}
