"use client";

import { AppIcon } from "@/components/app-square";
import { ALL_APPS_FRONTEND, getAppPath, getItemPath } from "@/lib/apps-frontend";
import { getUninstalledAppIds } from "@/lib/apps-utils";
import { cn } from "@/lib/utils";
import { ALL_APPS, ALL_APP_TAGS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Badge, Button, ScrollArea } from "@stackframe/stack-ui";
import { useChat } from "ai/react";
import { Blocks, Check, Copy, Download, ExternalLink, Globe, Info, KeyRound, Layout, Loader2, Play, Send, Settings, Shield, Sparkles, User, Zap } from "lucide-react";
import Image from "next/image";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export type CmdKPreviewProps = {
  isSelected: boolean,
  query: string,
  registerOnFocus: (onFocus: () => void) => void,
  unregisterOnFocus: (onFocus: () => void) => void,
  /** Called when user navigates back (left arrow) from this preview */
  onBlur: () => void,
  /** Register nested commands that will appear as a new column */
  registerNestedCommands: (commands: CmdKCommand[]) => void,
  /** Navigate into the nested column (call after registering commands) */
  navigateToNested: () => void,
  /** Current nesting depth (0 = first preview) */
  depth: number,
  /** Current pathname for checking active state */
  pathname: string,
};

// Memoized copy button for performance
const CopyButton = memo(function CopyButton({ text, className, size = "sm" }: {
  text: string,
  className?: string,
  size?: "sm" | "xs",
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  const iconSize = size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3";

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        runAsynchronously(handleCopy());
      }}
      className={cn(
        "shrink-0 rounded transition-colors hover:transition-none",
        size === "xs" ? "p-0.5" : "p-1",
        copied
          ? "text-green-400"
          : "text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/[0.08]",
        className
      )}
      title={copied ? "Copied!" : "Copy"}
      type="button"
    >
      {copied ? <Check className={iconSize} /> : <Copy className={iconSize} />}
    </button>
  );
});

// Truncate URL for display while keeping full URL for copy
function truncateUrl(url: string, maxLength = 50): string {
  if (url.length <= maxLength) return url;
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search;
    if (path.length > 30) {
      return urlObj.host + path.slice(0, 20) + "..." + path.slice(-10);
    }
    return url.slice(0, maxLength - 3) + "...";
  } catch {
    return url.slice(0, maxLength - 3) + "...";
  }
}

// Inline code with smart copy button
const InlineCode = memo(function InlineCode({ children }: { children?: React.ReactNode }) {
  const text = String(children || "");
  const isUrl = /^https?:\/\//.test(text);
  const isCommand = /^(npm|npx|pnpm|yarn|curl|git|docker|cd|mkdir|ls|brew|apt|pip)/.test(text);
  const isPath = /^[./~]/.test(text) && text.includes("/");
  const showCopy = isUrl || isCommand || isPath || text.length > 15;

  // For very long URLs, show truncated version
  const displayText = isUrl && text.length > 60 ? truncateUrl(text, 55) : text;

  return (
    <code className={cn(
      "inline-flex items-center gap-1 max-w-full rounded px-1.5 py-0.5",
      "bg-foreground/[0.06] text-[11px] font-mono leading-relaxed",
      "break-all"
    )}>
      <span className={cn(
        "min-w-0",
        isUrl ? "text-blue-400" : "text-foreground/90"
      )}>
        {displayText}
      </span>
      {showCopy && <CopyButton text={text} size="xs" />}
    </code>
  );
});

// Code block with language label and copy
const CodeBlock = memo(function CodeBlock({ children, className }: {
  children?: React.ReactNode,
  className?: string,
}) {
  const text = String(children || "").replace(/\n$/, "");
  const language = className?.replace("language-", "").toUpperCase() ?? "";

  return (
    <div className="relative group my-2.5 rounded-lg bg-foreground/[0.04] ring-1 ring-foreground/[0.06] overflow-hidden">
      {/* Header with language and copy */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-foreground/[0.06] bg-foreground/[0.02]">
        <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider">
          {language || "CODE"}
        </span>
        <CopyButton text={text} size="xs" />
      </div>
      {/* Code content */}
      <div className="overflow-x-auto">
        <pre className="p-3 text-[11px] font-mono leading-relaxed">
          <code className="text-foreground/90">{children}</code>
        </pre>
      </div>
    </div>
  );
});

// Smart link component with copy and external icon
const SmartLink = memo(function SmartLink({ href, children }: {
  href?: string,
  children?: React.ReactNode,
}) {
  const displayText = String(children || href || "");
  const isFullUrl = href?.startsWith("http");
  const isDocsLink = href?.includes("docs.stack-auth.com");

  // Truncate long URLs for display
  const truncatedDisplay = displayText.length > 55 ? truncateUrl(displayText, 50) : displayText;

  return (
    <span className="inline-flex items-center gap-1 max-w-full">
      <a
        href={href}
        className={cn(
          "inline-flex items-center gap-1 text-blue-400 hover:text-blue-300",
          "hover:underline underline-offset-2 transition-colors hover:transition-none",
          "break-all"
        )}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="min-w-0">{truncatedDisplay}</span>
        {isFullUrl && !isDocsLink && (
          <ExternalLink className="shrink-0 h-2.5 w-2.5 opacity-60" />
        )}
      </a>
      {isFullUrl && href && <CopyButton text={href} size="xs" />}
    </span>
  );
});

// Memoized markdown components for consistent rendering
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] text-foreground/90 mb-2.5 last:mb-0 leading-relaxed">
      {children}
    </p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-[13px] text-foreground/90 mb-2.5 pl-4 space-y-1 list-disc marker:text-muted-foreground/40">
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="text-[13px] text-foreground/90 mb-2.5 pl-4 space-y-1.5 list-decimal marker:text-muted-foreground/60">
      {children}
    </ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed pl-0.5">{children}</li>
  ),
  code: ({ children, className }: { children?: React.ReactNode, className?: string }) => {
    if (className) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return <InlineCode>{children}</InlineCode>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-foreground/80">{children}</em>
  ),
  a: SmartLink,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2.5 rounded-lg ring-1 ring-foreground/[0.08]">
      <table className="w-full text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-foreground/[0.04] border-b border-foreground/[0.08]">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-foreground/[0.04]">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-2.5 py-1.5 text-left font-semibold text-foreground/90 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-2.5 py-1.5 text-foreground/70">{children}</td>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-semibold text-foreground mt-3 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-[13px] font-semibold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[13px] font-semibold text-foreground mt-2.5 mb-1 first:mt-0">{children}</h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-purple-500/40 pl-3 my-2 text-foreground/70 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-foreground/[0.06]" />,
};

// In-memory cache for AI conversations by query
type CachedMessage = { id: string, role: "user" | "assistant" | "system" | "data", content: string };
type CachedConversation = {
  messages: CachedMessage[],
};
const conversationCache = new Map<string, CachedConversation>();

// Helper to count words in a string
function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Helper to get first N words from text
function getFirstNWords(text: string, n: number): string {
  const words = text.split(/(\s+)/); // Split but keep whitespace
  let wordCount = 0;
  let result = "";
  for (const part of words) {
    if (part.trim()) {
      wordCount++;
      if (wordCount > n) break;
    }
    result += part;
  }
  return result;
}

// Memoized user message component
const UserMessage = memo(function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex gap-2.5 justify-end">
      <div className="min-w-0 rounded-xl px-3.5 py-2 max-w-[80%] bg-blue-500/10 text-foreground">
        <p className="text-[13px] leading-relaxed break-words">{content}</p>
      </div>
      <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-blue-500/10 flex items-center justify-center">
        <User className="h-3 w-3 text-blue-400" />
      </div>
    </div>
  );
});

// Memoized assistant message component with word-by-word streaming
const AssistantMessage = memo(function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="flex gap-2.5 justify-start">
      <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-purple-500/10 flex items-center justify-center">
        <Sparkles className="h-3 w-3 text-purple-400" />
      </div>
      <div className="min-w-0 rounded-xl px-3.5 py-2 max-w-[calc(100%-2rem)] bg-foreground/[0.02]">
        <div className="min-w-0 overflow-hidden">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
});

/**
 * AI Chat Preview Component
 *
 * Handles AI conversation with debounced query submission and caching.
 *
 * Key behaviors:
 * 1. When query changes, wait 400ms (debounce) before sending API request
 * 2. If query changes during debounce, cancel previous and start new debounce
 * 3. Cached conversations are restored immediately without API call
 * 4. Word-by-word streaming animation for assistant responses
 *
 * State management:
 * - `activeQueryRef`: The query we're currently showing/processing (source of truth)
 * - `pendingTimeoutId`: Current debounce timeout (null if none pending)
 * - `conversationCache`: Global cache mapping query -> messages
 */
const AIChatPreview = memo(function AIChatPreview({
  query,
  registerOnFocus,
  unregisterOnFocus,
  onBlur,
}: CmdKPreviewProps) {
  const [followUpInput, setFollowUpInput] = useState("");
  const [isDebouncing, setIsDebouncing] = useState(false);
  const [displayedWordCount, setDisplayedWordCount] = useState(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  /**
   * The query that is currently "active" - either being debounced, loading, or displayed.
   * This is the source of truth for which conversation we're working with.
   * Updated synchronously when we decide to process a new query.
   */
  const activeQueryRef = useRef<string>("");

  /**
   * ID of the pending debounce timeout, or null if no debounce is pending.
   * Used to cancel previous debounce when query changes.
   */
  const pendingTimeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    messages,
    isLoading: aiLoading,
    append,
    setMessages,
    stop: stopChat,
    error: aiError,
  } = useChat({
    api: "/api/ai-search",
  });

  // Get the last assistant message for word-by-word streaming
  const lastAssistantMessage = messages.slice(1).findLast(m => m.role === "assistant");
  const lastAssistantContent = lastAssistantMessage?.content ?? "";
  const actualWordCount = lastAssistantContent ? countWords(lastAssistantContent) : 0;
  const isStreaming = aiLoading && lastAssistantMessage;

  // Use ref to track target word count for the interval (avoids stale closure)
  const targetWordCountRef = useRef(0);
  targetWordCountRef.current = actualWordCount;

  // Progressive word reveal effect using interval
  const hasAssistantContent = Boolean(lastAssistantContent);
  useEffect(() => {
    if (!hasAssistantContent) {
      setDisplayedWordCount(0);
      return;
    }

    const intervalId = setInterval(() => {
      setDisplayedWordCount(prev => {
        if (prev < targetWordCountRef.current) {
          return prev + 1;
        }
        return prev;
      });
    }, 15);

    return () => clearInterval(intervalId);
  }, [hasAssistantContent]);

  // Reset word count when query changes
  useEffect(() => {
    setDisplayedWordCount(0);
  }, [query]);

  /**
   * Save messages to cache whenever they change.
   * Only saves if we have an active query and messages to save.
   */
  useEffect(() => {
    const currentQuery = activeQueryRef.current;
    if (messages.length > 0 && currentQuery) {
      conversationCache.set(currentQuery, {
        messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content })),
      });
    }
  }, [messages]);

  /**
   * Main effect: Handle query changes with debouncing and caching.
   *
   * This effect runs whenever `query` changes. It:
   * 1. Cancels any pending debounce timeout
   * 2. Checks if we already have this query cached
   * 3. If cached: restore immediately
   * 4. If not cached: start debounce, then send API request
   *
   * Race condition prevention:
   * - We capture `trimmedQuery` at the start and use it throughout
   * - The timeout callback checks if `activeQueryRef.current` still matches
   * - If query changed during debounce, the callback becomes a no-op
   */
  useEffect(() => {
    const trimmedQuery = query.trim();

    // Always cancel any pending timeout when query changes
    if (pendingTimeoutIdRef.current !== null) {
      clearTimeout(pendingTimeoutIdRef.current);
      pendingTimeoutIdRef.current = null;
    }

    // Handle empty query
    if (!trimmedQuery) {
      // Stop any in-flight request and clear state
      stopChat();
      activeQueryRef.current = "";
      setIsDebouncing(false);
      setMessages([]);
      return;
    }

    // If this is the same query we're already processing, do nothing
    if (trimmedQuery === activeQueryRef.current) {
      return;
    }

    // IMPORTANT: Stop any in-flight request for the previous query
    // This prevents the old response from being added to messages
    stopChat();

    // Update active query immediately (this is our source of truth)
    activeQueryRef.current = trimmedQuery;

    // Check cache first
    const cached = conversationCache.get(trimmedQuery);
    if (cached && cached.messages.length > 0) {
      // Restore from cache immediately, no debounce needed
      setMessages(cached.messages);
      setIsDebouncing(false);
      return;
    }

    // Not cached - need to make API request with debounce
    // Clear messages for the new query
    setMessages([]);
    setIsDebouncing(true);

    // Start debounce timer
    // Capture the query in closure to verify it hasn't changed when timeout fires
    const queryForThisTimeout = trimmedQuery;
    pendingTimeoutIdRef.current = setTimeout(() => {
      pendingTimeoutIdRef.current = null;

      // CRITICAL: Check if this is still the active query
      // If user typed more characters, activeQueryRef will have changed
      // and we should NOT send this request
      if (activeQueryRef.current !== queryForThisTimeout) {
        return; // Query changed during debounce, abort
      }

      // Send the API request
      setIsDebouncing(false);
      runAsynchronously(append({ role: "user", content: queryForThisTimeout }));
    }, 400);

    // Cleanup: cancel timeout and stop chat if component unmounts or query changes
    return () => {
      stopChat();
      if (pendingTimeoutIdRef.current !== null) {
        clearTimeout(pendingTimeoutIdRef.current);
        pendingTimeoutIdRef.current = null;
      }
    };
  }, [query, append, setMessages, stopChat]);

  // Focus handler - select the follow-up input when focused (pressing right arrow or Enter)
  useEffect(() => {
    const focusHandler = () => {
      followUpInputRef.current?.focus();
      followUpInputRef.current?.select();
    };
    registerOnFocus(focusHandler);
    return () => unregisterOnFocus(focusHandler);
  }, [registerOnFocus, unregisterOnFocus]);

  // Track if user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Auto-scroll only when new messages are added or when already at bottom
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

  // Handle follow-up questions
  const handleFollowUp = useCallback(async () => {
    if (!followUpInput.trim() || aiLoading) return;
    const input = followUpInput;
    setFollowUpInput("");
    await append({ role: "user", content: input });
    // Refocus the input after sending
    requestAnimationFrame(() => {
      followUpInputRef.current?.focus();
    });
  }, [followUpInput, append, aiLoading]);

  // Handle follow-up input keyboard
  const handleFollowUpKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        runAsynchronously(handleFollowUp());
      } else if (e.key === "ArrowLeft") {
        // If cursor is at the start of the input, blur the preview
        const input = e.currentTarget;
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          e.stopPropagation();
          onBlur();
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // Scroll the chat history
        e.preventDefault();
        e.stopPropagation();
        const container = messagesContainerRef.current;
        if (container) {
          const scrollAmount = e.key === "ArrowUp" ? -100 : 100;
          container.scrollBy({ top: scrollAmount, behavior: "smooth" });
        }
      }
    },
    [handleFollowUp, onBlur]
  );

  return (
    <div className="flex flex-col h-full w-full">
      {/* Messages - skip the first user message (the initial query) */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {messages.slice(1).map((message, index, arr) => {
          // For the last assistant message, apply word-by-word streaming
          const isLastAssistant = message.role === "assistant" &&
            index === arr.length - 1 - (arr[arr.length - 1]?.role === "user" ? 1 : 0);
          const displayContent = message.role === "assistant" && isLastAssistant
            ? getFirstNWords(message.content, displayedWordCount)
            : message.content;

          // Don't render if no content to show yet
          if (message.role === "assistant" && isLastAssistant && !displayContent) {
            return null;
          }

          if (message.role === "user") {
            return <UserMessage key={message.id || index} content={message.content} />;
          }
          return <AssistantMessage key={message.id || index} content={displayContent} />;
        })}

        {/* Loading indicator - show during debounce or when waiting for response */}
        {(isDebouncing || (aiLoading && !messages.some(m => m.role === "assistant" && m.content))) && (
          <div className="flex gap-2.5 justify-start">
            <div className="shrink-0 w-6 h-6 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Sparkles className="h-3 w-3 text-purple-400" />
            </div>
            <div className="bg-foreground/[0.02] rounded-xl px-3.5 py-2">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming indicator at the end - show when still loading or still revealing words */}
        {(isStreaming || displayedWordCount < actualWordCount) && displayedWordCount > 0 && (
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

      {/* Follow-up input */}
      <div className="shrink-0 border-t border-foreground/[0.05] px-3.5 py-2.5">
        <div className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-1.5 ring-1 ring-foreground/[0.05] focus-within:ring-purple-500/25 transition-shadow">
          <input
            ref={followUpInputRef}
            type="text"
            value={followUpInput}
            onChange={(e) => setFollowUpInput(e.target.value)}
            onKeyDown={handleFollowUpKeyDown}
            placeholder="Ask a follow-up question..."
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={aiLoading}
          />
          <button
            onClick={() => runAsynchronously(handleFollowUp())}
            disabled={!followUpInput.trim() || aiLoading}
            className={cn(
              "p-1 rounded transition-colors hover:transition-none",
              followUpInput.trim() && !aiLoading
                ? "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                : "text-muted-foreground/25 cursor-not-allowed"
            )}
            type="button"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[9px] text-muted-foreground/40 mt-1.5 text-center">
          Enter to send
        </p>
      </div>
    </div>
  );
});

// Run Query Preview Component - shows a TODO message for now
const RunQueryPreview = memo(function RunQueryPreview({
  query,
}: CmdKPreviewProps) {
  return (
    <div className="flex flex-col h-full w-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <Play className="h-8 w-8 text-amber-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Run Query</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Execute actions using natural language commands.
          </p>
        </div>
        <div className="w-full p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
          <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-2">Your query:</p>
          <p className="text-sm text-foreground italic">&ldquo;{query}&rdquo;</p>
        </div>
        <div className="mt-4 p-4 rounded-xl bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground">
            🚧 <span className="font-medium">Coming Soon</span> — This feature is under development.
            Soon you&apos;ll be able to run queries like &ldquo;create a new user&rdquo;,
            &ldquo;list all teams&rdquo;, or &ldquo;update project settings&rdquo;.
          </p>
        </div>
      </div>
    </div>
  );
});

// Create Dashboard Preview Component - shows a TODO message for now
const CreateDashboardPreview = memo(function CreateDashboardPreview({
  query,
}: CmdKPreviewProps) {
  return (
    <div className="flex flex-col h-full w-full items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center">
          <Layout className="h-8 w-8 text-cyan-500" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Create Dashboard</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Generate custom dashboards for your users.
          </p>
        </div>
        <div className="w-full p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
          <p className="text-xs text-cyan-600 dark:text-cyan-400 font-medium mb-2">Your query:</p>
          <p className="text-sm text-foreground italic">&ldquo;{query}&rdquo;</p>
        </div>
        <div className="mt-4 p-4 rounded-xl bg-muted/50 border border-border">
          <p className="text-xs text-muted-foreground">
            🚧 <span className="font-medium">Coming Soon</span> — This feature is under development.
            Soon you&apos;ll be able to create custom dashboards like &ldquo;analytics overview&rdquo;,
            &ldquo;user management panel&rdquo;, or &ldquo;team activity feed&rdquo;.
          </p>
        </div>
      </div>
    </div>
  );
});

// Available App Preview Component - shows app store page in preview panel
const AvailableAppPreview = memo(function AvailableAppPreview({
  appId,
  projectId,
  onEnable,
}: {
  appId: AppId,
  projectId: string,
  onEnable: () => Promise<void>,
}) {
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  const features = [
    { icon: Shield, label: "Secure" },
    { icon: Zap, label: "Quick Setup" },
    { icon: Check, label: "Production Ready" },
  ];

  return (
    <div className="flex flex-col h-full w-full">
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 flex-shrink-0">
              <AppIcon
                appId={appId}
                className="shadow-md ring-1 ring-black/5 dark:ring-white/10 w-full h-full"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-semibold text-foreground truncate">
                  {app.displayName}
                </h3>
                {app.stage !== "stable" && (
                  <Badge
                    variant={app.stage === "alpha" ? "destructive" : "secondary"}
                    className="text-[9px] px-1.5 py-0"
                  >
                    {app.stage === "alpha" ? "Alpha" : "Beta"}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {app.subtitle}
              </p>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {(app.tags as Array<keyof typeof ALL_APP_TAGS>).map((tag) => (
              <div
                key={tag}
                className={cn(
                  "px-2 py-0.5 rounded-full text-[10px] font-medium",
                  tag === "expert"
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {ALL_APP_TAGS[tag].displayName}
              </div>
            ))}
          </div>

          {/* Features */}
          <div className="grid grid-cols-3 gap-2">
            {features.map((feature, index) => (
              <div
                key={index}
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-muted/50 border border-border/50"
              >
                <feature.icon className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[9px] text-muted-foreground text-center">
                  {feature.label}
                </span>
              </div>
            ))}
          </div>

          {/* Enable Button */}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => runAsynchronouslyWithAlert(onEnable())}
              size="sm"
              className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white font-medium"
            >
              Enable App
            </Button>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Info className="w-3 h-3" />
              <span>Free</span>
            </div>
          </div>

          {/* Stage Warning */}
          {app.stage !== "stable" && (
            <div
              className={cn(
                "p-2.5 rounded-lg border-l-2 text-[11px]",
                app.stage === "alpha"
                  ? "bg-red-50 dark:bg-red-950/20 border-red-500 text-red-800 dark:text-red-300"
                  : "bg-amber-50 dark:bg-amber-950/20 border-amber-500 text-amber-800 dark:text-amber-300"
              )}
            >
              {app.stage === "alpha" && (
                <><strong>Alpha:</strong> Early development, may have bugs.</>
              )}
              {app.stage === "beta" && (
                <><strong>Beta:</strong> Being tested, generally stable.</>
              )}
            </div>
          )}

          {/* Screenshots */}
          {appFrontend.screenshots.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-foreground mb-2">Preview</h4>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {appFrontend.screenshots.map((screenshot: string, index: number) => (
                  <div
                    key={index}
                    className="relative h-32 w-48 rounded-lg shadow-sm flex-shrink-0 overflow-hidden border border-border"
                  >
                    <Image
                      src={screenshot}
                      alt={`${app.displayName} screenshot ${index + 1}`}
                      fill
                      className="object-cover select-none"
                      draggable={false}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {appFrontend.storeDescription && (
            <div>
              <h4 className="text-xs font-medium text-foreground mb-2">About</h4>
              <div className="text-xs text-muted-foreground prose prose-sm dark:prose-invert max-w-none">
                {appFrontend.storeDescription}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

// Factory to create available app preview components
function createAvailableAppPreview(appId: AppId, projectId: string, onEnable: () => Promise<void>): React.ComponentType<CmdKPreviewProps> {
  return function AvailableAppPreviewWrapper() {
    return <AvailableAppPreview appId={appId} projectId={projectId} onEnable={onEnable} />;
  };
}

// Cache for available app preview components
const availableAppPreviewCache = new Map<string, React.ComponentType<CmdKPreviewProps>>();

function getOrCreateAvailableAppPreview(appId: AppId, projectId: string, onEnable: () => Promise<void>): React.ComponentType<CmdKPreviewProps> {
  const cacheKey = `${appId}:${projectId}`;
  let preview = availableAppPreviewCache.get(cacheKey);
  if (!preview) {
    preview = createAvailableAppPreview(appId, projectId, onEnable);
    availableAppPreviewCache.set(cacheKey, preview);
  }
  return preview;
}

export type CmdKCommand = {
  id: string,
  icon: React.ReactNode,
  label: string,
  description: string,
  keywords?: string[],
  onAction: {
    type: "focus",
  } | {
    type: "action",
    action: () => void | Promise<void>,
  } | {
    type: "navigate",
    href: string,
  },
  preview: null | React.ComponentType<CmdKPreviewProps>,
  /** If true, the preview renders a visual component that should be shown in the preview panel */
  hasVisualPreview?: boolean,
  /** Optional highlight color for special styling (e.g., "purple" for AI commands) */
  highlightColor?: string,
};

// Factory to create app preview components that show navigation items
function createAppPreview(appId: AppId, projectId: string): React.ComponentType<CmdKPreviewProps> {
  // Pre-compute these outside the component since they're static per appId
  const app = ALL_APPS[appId];
  const appFrontend = ALL_APPS_FRONTEND[appId];

  // Pre-compute nested commands since they're static
  const IconComponent = appFrontend.icon;
  const nestedCommands: CmdKCommand[] = appFrontend.navigationItems.map((navItem) => ({
    id: `apps/${appId}/nav/${navItem.displayName.toLowerCase().replace(/\s+/g, '-')}`,
    icon: <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />,
    label: navItem.displayName,
    description: app.displayName,
    keywords: [app.displayName.toLowerCase(), navItem.displayName.toLowerCase()],
    onAction: { type: "navigate" as const, href: getItemPath(projectId, appFrontend, navItem) },
    preview: null,
  }));

  return function AppPreview({
    registerOnFocus,
    unregisterOnFocus,
    registerNestedCommands,
    navigateToNested,
  }: CmdKPreviewProps) {
    useEffect(() => {
      const focusHandler = () => {
        registerNestedCommands(nestedCommands);
        navigateToNested();
      };
      registerOnFocus(focusHandler);
      return () => unregisterOnFocus(focusHandler);
    }, [registerOnFocus, unregisterOnFocus, registerNestedCommands, navigateToNested]);

    return null; // No visual preview, just nested commands
  };
}

// Cache for app preview components to avoid recreating them
const appPreviewCache = new Map<string, React.ComponentType<CmdKPreviewProps>>();

function getOrCreateAppPreview(appId: AppId, projectId: string): React.ComponentType<CmdKPreviewProps> {
  const cacheKey = `${appId}:${projectId}`;
  let preview = appPreviewCache.get(cacheKey);
  if (!preview) {
    preview = createAppPreview(appId, projectId);
    appPreviewCache.set(cacheKey, preview);
  }
  return preview;
}

export function useCmdKCommands({
  projectId,
  enabledApps,
  query,
  onEnableApp,
}: {
  projectId: string,
  enabledApps: AppId[],
  query: string,
  onEnableApp?: (appId: AppId) => Promise<void>,
}): CmdKCommand[] {
  return useMemo(() => {
    const commands: CmdKCommand[] = [];

    // Overview
    commands.push({
      id: "navigation/overview",
      icon: <Globe className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Overview",
      description: "Navigation",
      keywords: ["home", "dashboard", "main"],
      onAction: { type: "navigate", href: `/projects/${projectId}` },
      preview: null,
    });

    // Installed apps - with preview for navigation items
    for (const appId of enabledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      // Some enabled apps might not have navigation metadata yet
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!app || !appFrontend) continue;

      const IconComponent = appFrontend.icon;
      const hasNavigationItems = appFrontend.navigationItems.length > 0;

      // Add the app itself as a command
      commands.push({
        id: `apps/${appId}`,
        icon: <IconComponent className="h-3.5 w-3.5 stroke-emerald-600 dark:stroke-emerald-400" />,
        label: app.displayName,
        description: "Installed app",
        keywords: [app.displayName.toLowerCase(), ...app.tags, "installed", "app"],
        onAction: { type: "navigate", href: getAppPath(projectId, appFrontend) },
        preview: hasNavigationItems ? getOrCreateAppPreview(appId, projectId) : null,
        highlightColor: "app",
      });
    }

    // Available (uninstalled) apps
    const uninstalledApps = getUninstalledAppIds(enabledApps);
    for (const appId of uninstalledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      // Some apps might not have frontend metadata yet
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!app || !appFrontend) continue;

      const IconComponent = appFrontend.icon;
      const hasPreview = onEnableApp !== undefined;

      commands.push({
        id: `store/${appId}`,
        icon: (
          <div className="relative">
            <IconComponent className="h-3.5 w-3.5 text-muted-foreground/50" />
            <Download className="h-2 w-2 text-muted-foreground absolute -bottom-0.5 -right-0.5" />
          </div>
        ),
        label: app.displayName,
        description: "Available to install",
        keywords: [app.displayName.toLowerCase(), ...app.tags, "available", "install", "store", "app"],
        onAction: hasPreview
          ? { type: "focus" }
          : { type: "navigate", href: `/projects/${projectId}/apps/${appId}` },
        preview: hasPreview
          ? getOrCreateAvailableAppPreview(appId, projectId, () => onEnableApp(appId))
          : null,
        hasVisualPreview: hasPreview,
      });
    }

    // Settings items
    commands.push({
      id: "settings/explore-apps",
      icon: <Blocks className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Explore Apps",
      description: "Settings",
      keywords: ["apps", "marketplace", "store", "install"],
      onAction: { type: "navigate", href: `/projects/${projectId}/apps` },
      preview: null,
    });

    commands.push({
      id: "settings/project-keys",
      icon: <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Project Keys",
      description: "Settings",
      keywords: ["api", "keys", "credentials", "secret"],
      onAction: { type: "navigate", href: `/projects/${projectId}/project-keys` },
      preview: null,
    });

    commands.push({
      id: "settings/project-settings",
      icon: <Settings className="h-3.5 w-3.5 text-muted-foreground" />,
      label: "Project Settings",
      description: "Settings",
      keywords: ["config", "configuration", "options"],
      onAction: { type: "navigate", href: `/projects/${projectId}/project-settings` },
      preview: null,
    });

    // AI-powered options (only when there's a query)
    if (query.trim()) {
      commands.push({
        id: "ai/ask",
        icon: <Sparkles className="h-3.5 w-3.5 text-purple-400" />,
        label: `Ask AI`,
        description: "Get an AI-powered answer from Stack Auth docs",
        keywords: ["ai", "assistant", "help", "question"],
        onAction: { type: "focus" },
        preview: AIChatPreview,
        hasVisualPreview: true,
        highlightColor: "purple",
      });

      commands.push({
        id: "query/run",
        icon: <Play className="h-3.5 w-3.5 text-amber-500" />,
        label: `Run Query`,
        description: "Execute actions using natural language",
        keywords: ["run", "execute", "query", "action", "command", "vibecode"],
        onAction: { type: "focus" },
        preview: RunQueryPreview,
        hasVisualPreview: true,
        highlightColor: "gold",
      });

      commands.push({
        id: "create/dashboard",
        icon: <Layout className="h-3.5 w-3.5 text-cyan-500" />,
        label: `Create Dashboard`,
        description: "Generate custom dashboards for your users",
        keywords: ["create", "dashboard", "generate", "ui", "interface", "panel"],
        onAction: { type: "focus" },
        preview: CreateDashboardPreview,
        hasVisualPreview: true,
        highlightColor: "cyan",
      });
    }

    return commands;
  }, [projectId, enabledApps, query, onEnableApp]);
}
