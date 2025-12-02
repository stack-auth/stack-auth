"use client";

import { ALL_APPS_FRONTEND, getAppPath, getItemPath } from "@/lib/apps-frontend";
import { getUninstalledAppIds } from "@/lib/apps-utils";
import { cn } from "@/lib/utils";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useChat } from "ai/react";
import { Blocks, Check, Copy, Download, ExternalLink, Globe, KeyRound, Loader2, Send, Settings, Sparkles, User } from "lucide-react";
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

// AI Chat Preview Component
const AIChatPreview = memo(function AIChatPreview({
  query,
  registerOnFocus,
  unregisterOnFocus,
  onBlur,
}: CmdKPreviewProps) {
  const [followUpInput, setFollowUpInput] = useState("");
  const [isDebouncing, setIsDebouncing] = useState(true); // Start as debouncing
  const [displayedWordCount, setDisplayedWordCount] = useState(0); // Word-by-word streaming
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const lastQueryRef = useRef<string>("");
  const currentQueryRef = useRef<string>(query); // Track current query for caching

  const {
    messages,
    isLoading: aiLoading,
    append,
    setMessages,
    error: aiError,
  } = useChat({
    api: "/api/ai-search",
  });

  // Get the last assistant message for word-by-word streaming
  const lastAssistantMessage = messages.slice(1).findLast(m => m.role === "assistant");
  const lastAssistantContent = lastAssistantMessage?.content ?? "";
  const actualWordCount = lastAssistantContent ? countWords(lastAssistantContent) : 0;
  const isStreaming = aiLoading && lastAssistantMessage;

  // Use ref to track target word count for the interval
  const targetWordCountRef = useRef(0);
  targetWordCountRef.current = actualWordCount;

  // Progressive word reveal effect using interval
  const hasAssistantContent = Boolean(lastAssistantContent);
  useEffect(() => {
    if (!hasAssistantContent) {
      setDisplayedWordCount(0);
      return;
    }

    // Use interval to continuously catch up to target
    const intervalId = setInterval(() => {
      setDisplayedWordCount(prev => {
        if (prev < targetWordCountRef.current) {
          return prev + 1;
        }
        return prev;
      });
    }, 15);

    return () => clearInterval(intervalId);
  }, [hasAssistantContent]); // Only restart interval when message appears/disappears

  // Reset word count when query changes
  useEffect(() => {
    setDisplayedWordCount(0);
  }, [query]);

  // Save messages to cache when they change (only if we have messages and a query)
  useEffect(() => {
    if (messages.length > 0 && currentQueryRef.current) {
      conversationCache.set(currentQueryRef.current, {
        messages: messages.map(m => ({ id: m.id, role: m.role, content: m.content })),
      });
    }
  }, [messages]);

  // Track if we've started a request for the current query
  const hasStartedForQueryRef = useRef<string>("");

  // Auto-start AI conversation with debounce when query changes
  useEffect(() => {
    if (!query.trim()) {
      setIsDebouncing(false);
      return;
    }

    const queryChanged = query !== lastQueryRef.current;

    if (queryChanged) {
      lastQueryRef.current = query;
      currentQueryRef.current = query;
      hasStartedForQueryRef.current = ""; // Reset started flag for new query

      // Check if we have a cached conversation for this query
      const cached = conversationCache.get(query);
      if (cached && cached.messages.length > 0) {
        // Restore cached conversation - no need to send request
        setMessages(cached.messages);
        setIsDebouncing(false);
        hasStartedForQueryRef.current = query; // Mark as started (from cache)
        return;
      }

      // New query without cache - start fresh
      setIsDebouncing(true);
      setMessages([]);

      // Debounce the API call
      const timeoutId = setTimeout(() => {
        // Send the actual request (append will update messages)
        runAsynchronously(append({ role: "user", content: query }));
        setIsDebouncing(false);
        hasStartedForQueryRef.current = query;
      }, 400);

      return () => clearTimeout(timeoutId);
    }

    // Handle mount case: query exists but we haven't started yet
    if (hasStartedForQueryRef.current !== query && messages.length === 0 && !aiLoading) {
      // Check cache first
      const cached = conversationCache.get(query);
      if (cached && cached.messages.length > 0) {
        setMessages(cached.messages);
        setIsDebouncing(false);
        hasStartedForQueryRef.current = query;
        return;
      }

      // Start fresh
      setIsDebouncing(true);
      const timeoutId = setTimeout(() => {
        runAsynchronously(append({ role: "user", content: query }));
        setIsDebouncing(false);
        hasStartedForQueryRef.current = query;
      }, 400);

      return () => clearTimeout(timeoutId);
    }
  }, [query, append, setMessages, messages.length, aiLoading]);

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
}: {
  projectId: string,
  enabledApps: AppId[],
  query: string,
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
        icon: <IconComponent className="h-3.5 w-3.5 text-muted-foreground" />,
        label: app.displayName,
        description: "Installed app",
        keywords: [app.displayName.toLowerCase(), ...app.tags, "installed", "app"],
        onAction: { type: "navigate", href: getAppPath(projectId, appFrontend) },
        preview: hasNavigationItems ? getOrCreateAppPreview(appId, projectId) : null,
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
        onAction: { type: "navigate", href: `/projects/${projectId}/apps/${appId}` },
        preview: null,
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

    // AI Assistant option (only when there's a query)
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
    }

    return commands;
  }, [projectId, enabledApps, query]);
}
