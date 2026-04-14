import { cn } from "@/components/ui";
import { buildStackAuthHeaders, type CurrentUser } from "@/lib/api-headers";
import { getPublicEnvVar } from "@/lib/env";
import type { UIMessage } from "@ai-sdk/react";
import { ArrowSquareOutIcon, CaretDownIcon, CheckIcon, CopyIcon, DatabaseIcon, SparkleIcon, SpinnerGapIcon, UserIcon } from "@phosphor-icons/react";
import { captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { convertToModelMessages, DefaultChatTransport } from "ai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";


export function createAskAiTransport({
  currentUser,
  projectId,
}: {
  currentUser: CurrentUser | null,
  projectId: string | undefined,
}): DefaultChatTransport<UIMessage> {
  const backendBaseUrl = getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_STACK_API_URL is not set");
  return new DefaultChatTransport<UIMessage>({
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
  });
}

// Memoized copy button for performance
export const CopyButton = memo(function CopyButton({ text, className, size = "sm" }: {
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
      {copied ? <CheckIcon className={iconSize} /> : <CopyIcon className={iconSize} />}
    </button>
  );
});

// Truncate URL for display while keeping full URL for copy
export function truncateUrl(url: string, maxLength = 50): string {
  if (url.length <= maxLength) return url;
  const match = url.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/);
  if (match) {
    const host = match[1];
    const path = (match[2] || "") + (match[3] || "");
    if (path.length > 30) {
      return host + path.slice(0, 20) + "..." + path.slice(-10);
    }
  }
  return url.slice(0, maxLength - 3) + "...";
}

// Inline code with smart copy button
export const InlineCode = memo(function InlineCode({ children }: { children?: React.ReactNode }) {
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
export const CodeBlock = memo(function CodeBlock({ children, className }: {
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
export const SmartLink = memo(function SmartLink({ href, children }: {
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
          <ArrowSquareOutIcon className="shrink-0 h-2.5 w-2.5 opacity-60" />
        )}
      </a>
      {isFullUrl && href && <CopyButton text={href} size="xs" />}
    </span>
  );
});

export type ToolInvocationPart = Extract<UIMessage["parts"][number], { type: `tool-${string}` }>;


// Expandable tool invocation card
export const ToolInvocationCard = memo(function ToolInvocationCard({
  invocation,
}: {
  invocation: ToolInvocationPart,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLoading = invocation.state === "input-streaming" || invocation.state === "input-available";
  const hasResult = invocation.state === "output-available";
  const hasError = invocation.state === "output-error";

  // Extract tool name from type (e.g., "tool-queryAnalytics" → "queryAnalytics")
  const toolName = invocation.type.replace(/^tool-/, "");

  // Format the tool name for display
  const getToolDisplay = () => {
    if (toolName === "queryAnalytics") {
      return { label: "Analytics Query", icon: DatabaseIcon };
    }
    return { label: toolName, icon: DatabaseIcon };
  };

  const { label, icon: Icon } = getToolDisplay();

  const input = invocation.input as { query?: string } | undefined;
  const queryArg = input?.query;
  const result = invocation.output as { success?: boolean, result?: unknown[], error?: string, rowCount?: number };

  return (
    <div
      className={cn(
        "my-2 rounded-lg overflow-hidden transition-all duration-200 ease-out",
        "bg-foreground/[0.03] ring-1 ring-foreground/[0.08]",
        isExpanded && "ring-purple-500/20"
      )}
    >
      {/* Header - always visible */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left",
          "hover:bg-foreground/[0.02] transition-colors"
        )}
      >
        <Icon className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        <span className="text-[12px] font-medium text-foreground/80 flex-1">
          {label}
        </span>
        {isLoading ? (
          <SpinnerGapIcon className="h-3 w-3 text-purple-400 animate-spin shrink-0" />
        ) : hasError ? (
          <span className="text-[10px] text-red-400/80 shrink-0">Error</span>
        ) : hasResult && result.success ? (
          <span className="text-[10px] text-green-400/80 shrink-0">
            {result.rowCount} {result.rowCount === 1 ? "row" : "rows"}
          </span>
        ) : hasResult && !result.success ? (
          <span className="text-[10px] text-red-400/80 shrink-0">Error</span>
        ) : null}
        <div className={cn(
          "transition-transform duration-200",
          isExpanded && "rotate-0",
          !isExpanded && "-rotate-90"
        )}>
          <CaretDownIcon className="h-3 w-3 text-muted-foreground/50" />
        </div>
      </button>

      {/* Expandable content */}
      <div
        className={cn(
          "grid transition-all duration-200 ease-out",
          isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-foreground/[0.06]">
            {/* Query */}
            {queryArg && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    Query
                  </span>
                  <CopyButton text={queryArg} size="xs" />
                </div>
                <pre className="text-[10px] font-mono text-foreground/70 bg-foreground/[0.03] rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all">
                  {queryArg}
                </pre>
              </div>
            )}

            {/* Result */}
            {hasResult && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    {result.success ? "Result" : "Error"}
                  </span>
                  {result.success && result.result && (
                    <CopyButton text={JSON.stringify(result.result, null, 2)} size="xs" />
                  )}
                </div>
                {result.success ? (
                  <pre className="text-[10px] font-mono text-foreground/70 bg-foreground/[0.03] rounded px-2 py-1.5 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(result.result, null, 2)}
                  </pre>
                ) : (
                  <div className="text-[11px] text-red-400/90 bg-red-500/[0.08] rounded px-2 py-1.5">
                    {result.error || "Query failed"}
                  </div>
                )}
              </div>
            )}

            {/* Error state from SDK */}
            {hasError && invocation.errorText && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[9px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    Error
                  </span>
                </div>
                <div className="text-[11px] text-red-400/90 bg-red-500/[0.08] rounded px-2 py-1.5">
                  {invocation.errorText}
                </div>
              </div>
            )}

            {/* Loading state */}
            {isLoading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 py-1">
                <SpinnerGapIcon className="h-3 w-3 animate-spin" />
                <span>Running query...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

// Memoized markdown components for consistent rendering
export const markdownComponents = {
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

// Helper to count words in a string
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Helper to get first N words from text
export function getFirstNWords(text: string, n: number): string {
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

// Helper to extract text content from UIMessage parts
export function getMessageContent(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text", text: string } => part.type === "text")
    .map(part => part.text)
    .join("");
}

// Helper to extract tool invocations from UIMessage parts
export function getToolInvocations(message: UIMessage): ToolInvocationPart[] {
  return message.parts.filter(
    (part): part is ToolInvocationPart => part.type.startsWith("tool-")
  );
}

// Memoized user message component
export const UserMessage = memo(function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex gap-2.5 justify-end">
      <div className="min-w-0 rounded-xl px-3.5 py-2 max-w-[80%] bg-blue-500/10 text-foreground">
        <p className="text-[13px] leading-relaxed break-words">{content}</p>
      </div>
      <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-blue-500/10 flex items-center justify-center">
        <UserIcon className="h-3 w-3 text-blue-400" />
      </div>
    </div>
  );
});

// Memoized assistant message component
export const AssistantMessage = memo(function AssistantMessage({
  content,
  toolInvocations,
}: {
  content: string,
  toolInvocations?: ToolInvocationPart[],
}) {
  const hasToolInvocations = toolInvocations && toolInvocations.length > 0;
  const hasContent = content.trim().length > 0;

  return (
    <div className="flex gap-2.5 justify-start">
      <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-purple-500/10 flex items-center justify-center">
        <SparkleIcon className="h-3 w-3 text-purple-400" />
      </div>
      <div className="min-w-0 max-w-[calc(100%-2rem)] flex flex-col gap-1">
        {/* Tool invocations */}
        {hasToolInvocations && (
          <div className="space-y-1">
            {toolInvocations.map((invocation) => (
              <ToolInvocationCard
                key={invocation.toolCallId}
                invocation={invocation}
              />
            ))}
          </div>
        )}

        {/* Text content */}
        {hasContent && (
          <div className="rounded-xl px-3.5 py-2 bg-foreground/[0.02]">
            <div className="min-w-0 overflow-hidden">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// Word streaming hook - handles the progressive word reveal animation
export function useWordStreaming(content: string) {
  const [displayedWordCount, setDisplayedWordCount] = useState(0);
  const targetWordCount = content ? countWords(content) : 0;
  const previousContentRef = useRef("");

  useEffect(() => {
    if (!content) {
      setDisplayedWordCount(0);
      previousContentRef.current = "";
      return;
    }
    if (!content.startsWith(previousContentRef.current)) {
      setDisplayedWordCount(0);
    }
    previousContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (targetWordCount === 0 || displayedWordCount >= targetWordCount) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setDisplayedWordCount(prev => Math.min(prev + 1, targetWordCount));
    }, 15);
    return () => clearTimeout(timeoutId);
  }, [displayedWordCount, targetWordCount]);

  return {
    displayedWordCount,
    targetWordCount,
    getDisplayContent: (text: string) => getFirstNWords(text, displayedWordCount),
    isRevealing: displayedWordCount < targetWordCount,
  };
}


// Classifies raw AI provider errors into user-friendly messages.
// The raw error is captured to Sentry separately via captureError — never shown to the user.
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
  // Unclassified — this is unexpected, report it
  captureError("ask-ai", error);
  return "Something went wrong. Please try again.";
}
