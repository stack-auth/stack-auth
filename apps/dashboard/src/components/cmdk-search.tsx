"use client";

import { useRouter } from "@/components/router";
import { cn } from "@/lib/utils";
import { type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useChat } from "ai/react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Send,
  Sparkles,
  User,
} from "lucide-react";
import { usePathname } from "next/navigation";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCmdKCommands, type CmdKCommand } from "./cmdk-commands";

// Reusable Results List Component
export const CmdKResultsList = memo(function CmdKResultsList({
  commands,
  selectedIndex,
  onSelect,
  onMouseEnter,
  pathname,
  emptyMessage = "Enter a search term or ask AI...",
  isParentColumn = false,
}: {
  commands: CmdKCommand[],
  selectedIndex: number,
  onSelect: (cmd: CmdKCommand) => void,
  onMouseEnter: (index: number) => void,
  pathname: string,
  emptyMessage?: string,
  /** When true, selection shows as outline only (for parent columns) */
  isParentColumn?: boolean,
}) {
  const hasResults = commands.length > 0;

  if (!hasResults) {
    return (
      <div className="h-full flex items-center justify-center select-none pointer-events-none">
        <div className="text-[13px] text-muted-foreground/50">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto py-1.5 px-2">
      {commands.map((cmd, index) => {
        const isSelected = index === selectedIndex;
        const isCurrentPage = cmd.onAction.type === "navigate" && pathname === cmd.onAction.href;

        // Parent column selection style: outline only
        const parentSelectionStyle = isSelected && isParentColumn
          ? "ring-1 ring-foreground/20 bg-transparent"
          : null;

        // Active column selection style: full background
        const activeSelectionStyle = isSelected && !isParentColumn
          ? cmd.highlightColor
            ? cmd.highlightColor === "purple"
              ? "bg-gradient-to-r from-purple-500/[0.15] to-purple-500/[0.08] ring-1 ring-purple-500/20"
              : cmd.highlightColor === "blue"
                ? "bg-gradient-to-r from-blue-500/[0.15] to-blue-500/[0.08] ring-1 ring-blue-500/20"
                : cmd.highlightColor === "green"
                  ? "bg-gradient-to-r from-green-500/[0.15] to-green-500/[0.08] ring-1 ring-green-500/20"
                  : "bg-foreground/[0.06]"
            : "bg-foreground/[0.06]"
          : null;

        return (
          <button
            key={cmd.id}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => onMouseEnter(index)}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left",
              "transition-colors duration-75",
              parentSelectionStyle,
              activeSelectionStyle,
              !isSelected && "bg-transparent"
            )}
          >
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md",
                cmd.highlightColor === "purple"
                  ? "bg-purple-500/10"
                  : cmd.highlightColor === "blue"
                    ? "bg-blue-500/10"
                    : cmd.highlightColor === "green"
                      ? "bg-green-500/10"
                      : "bg-foreground/[0.05]"
              )}
            >
              {cmd.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-foreground truncate">
                {cmd.label}
              </div>
              <div className="text-[11px] text-muted-foreground/70 truncate">
                {cmd.description}
              </div>
            </div>
            {isCurrentPage && (
              <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                Current
              </span>
            )}
            {/* Keyboard hints - only show when selected */}
            {isSelected && (
              <div className="flex items-center gap-1">
                {/* Show Arrow Right key if preview is available */}
                {cmd.preview && (
                  <kbd className="flex h-5 items-center justify-center rounded bg-foreground/[0.05] px-1.5 font-mono text-[10px] font-medium text-muted-foreground/60">
                    →
                  </kbd>
                )}
                {/* Show Enter key if action is executable (action or navigate) */}
                {(cmd.onAction.type === "action" || cmd.onAction.type === "navigate") && (
                  <kbd className="flex h-5 items-center justify-center rounded bg-foreground/[0.05] px-1.5 font-mono text-[10px] font-medium text-muted-foreground/60">
                    ↵
                  </kbd>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
});

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

export function CmdKSearch({
  projectId,
  enabledApps,
}: {
  projectId: string,
  enabledApps: AppId[],
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [aiMode, setAiMode] = useState(false);
  const [followUpInput, setFollowUpInput] = useState("");
  const [previewMode, setPreviewMode] = useState(false); // Mobile preview mode
  const [previewFocusHandlers, setPreviewFocusHandlers] = useState<Set<() => void>>(new Set());
  // Nested navigation state
  const [nestedColumns, setNestedColumns] = useState<CmdKCommand[][]>([]); // Commands for each nested column
  const [activeDepth, setActiveDepth] = useState(0); // Which column is active (0 = main list)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([0]); // Selected index in each column
  const [nestedBlurHandlers, setNestedBlurHandlers] = useState<(() => void)[]>([]); // onBlur handlers for each depth
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const columnsContainerRef = useRef<HTMLDivElement>(null);

  // AI chat hook for multi-turn conversation
  const {
    messages,
    isLoading: aiLoading,
    append,
    setMessages,
    error: aiError,
  } = useChat({
    api: "/api/ai-search",
  });

  // Track if user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    // Consider "near bottom" if within 100px of the bottom
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // Auto-scroll only when new messages are added or when already at bottom
  useEffect(() => {
    if (!messagesContainerRef.current || !aiMode) return;

    const container = messagesContainerRef.current;
    const messageCount = messages.length;

    // If a new message was added, scroll to bottom
    if (messageCount > lastMessageCountRef.current) {
      container.scrollTop = container.scrollHeight;
      isNearBottomRef.current = true;
    }
    // If streaming and user is near bottom, keep them at bottom (without smooth scroll)
    else if (aiLoading && isNearBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }

    lastMessageCountRef.current = messageCount;
  }, [messages, aiMode, aiLoading]);

  // Handle keyboard shortcut and custom event
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    const handleToggle = () => {
      setOpen((prev) => !prev);
    };

    document.addEventListener("keydown", down);
    window.addEventListener("spotlight-toggle", handleToggle);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener("spotlight-toggle", handleToggle);
    };
  }, []);

  // Focus and select input when opening
  useEffect(() => {
    if (open) {
      setSelectedIndex(0);
      setAiMode(false);
      setPreviewMode(false);
      setFollowUpInput("");
      setMessages([]);
      lastMessageCountRef.current = 0;
      isNearBottomRef.current = true;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, setMessages]);

  // Handle initial AI question
  const handleAskAI = useCallback(async () => {
    if (!query.trim()) return;
    setAiMode(true);
    setMessages([]);
    await append({ role: "user", content: query });
    requestAnimationFrame(() => {
      followUpInputRef.current?.focus();
    });
  }, [query, append, setMessages]);

  // Get commands from the hook
  const commands = useCmdKCommands({ projectId, enabledApps, query, onAskAI: handleAskAI });

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return [];

    const searchLower = query.toLowerCase().trim();
    return commands.filter((cmd) => {
      // AI command is always included when there's a query
      if (cmd.id === "ai/ask") return true;
      if (cmd.label.toLowerCase().includes(searchLower)) return true;
      if (cmd.description.toLowerCase().includes(searchLower)) return true;
      if (cmd.keywords?.some((k) => k.includes(searchLower))) return true;
      return false;
    });
  }, [query, commands]);

  // Get current commands based on active depth
  const getCurrentCommands = useCallback(() => {
    if (activeDepth === 0) return filteredCommands;
    return nestedColumns[activeDepth - 1] || [];
  }, [activeDepth, filteredCommands, nestedColumns]);

  // Get current selected index based on active depth
  const getCurrentSelectedIndex = useCallback(() => {
    return selectedIndices[activeDepth] ?? 0;
  }, [activeDepth, selectedIndices]);

  // Reset selection and close nested columns when results change
  useEffect(() => {
    setSelectedIndex(0);
    setSelectedIndices([0]);
    setNestedColumns([]);
    setActiveDepth(0);
    setNestedBlurHandlers([]);
  }, [filteredCommands.length]);

  // Clear nested columns when switching to a command without preview
  useEffect(() => {
    if (activeDepth === 0 && selectedIndex < filteredCommands.length) {
      const selectedCommand = filteredCommands[selectedIndex];
      if (!selectedCommand.preview) {
        // Clear nested state when no preview
        setNestedColumns([]);
        setSelectedIndices([selectedIndex]);
        setNestedBlurHandlers([]);
      }
    }
  }, [selectedIndex, filteredCommands, activeDepth]);

  const registerOnFocus = useCallback((onFocus: () => void) => {
    setPreviewFocusHandlers((prev) => new Set(prev).add(onFocus));
  }, []);

  const unregisterOnFocus = useCallback((onFocus: () => void) => {
    setPreviewFocusHandlers((prev) => {
      const next = new Set(prev);
      next.delete(onFocus);
      return next;
    });
  }, []);

  // Register nested commands from a preview component
  const registerNestedCommands = useCallback((commands: CmdKCommand[], depth: number) => {
    setNestedColumns((prev) => {
      const next = [...prev];
      next[depth] = commands;
      return next;
    });
    setSelectedIndices((prev) => {
      const next = [...prev];
      while (next.length <= depth) {
        next.push(0);
      }
      return next;
    });
  }, []);

  // Register onBlur handler for a depth level
  const registerNestedBlur = useCallback((onBlur: () => void, depth: number) => {
    setNestedBlurHandlers((prev) => {
      const next = [...prev];
      next[depth] = onBlur;
      return next;
    });
  }, []);

  // Stable wrapper for registerNestedCommands at depth 0
  const registerNestedCommandsDepth0 = useCallback((commands: CmdKCommand[]) => {
    registerNestedCommands(commands, 0);
  }, [registerNestedCommands]);

  // Stable wrapper for navigateToNested
  const navigateToNestedDepth1 = useCallback(() => {
    setActiveDepth(1);
    setSelectedIndices((prev) => {
      const next = [...prev];
      if (next.length <= 1) {
        next.push(0);
      }
      return next;
    });
  }, []);

  // Stable no-op for onBlur
  const noopOnBlur = useCallback(() => {
    // Handle blur from preview
  }, []);

  const handleSelectCommand = useCallback(
    (command: CmdKCommand) => {
      if (command.onAction.type === "navigate") {
        setOpen(false);
        router.push(command.onAction.href);
      } else if (command.onAction.type === "action") {
        runAsynchronously(Promise.resolve(command.onAction.action()));
        // Don't close for highlighted commands (like AI)
        if (!command.highlightColor) {
          setOpen(false);
        }
      } else {
        // Focus type - trigger the right arrow action (navigate into preview)
        if (command.preview) {
          // On mobile, show preview fullscreen
          if (typeof window !== "undefined" && window.innerWidth < 768) {
            setPreviewMode(true);
          } else {
            // On desktop, trigger the focus handlers to navigate into nested commands
            previewFocusHandlers.forEach((handler) => handler());
          }
        }
      }
    },
    [router, previewFocusHandlers]
  );

  const handleBackFromPreview = useCallback(() => {
    setPreviewMode(false);
  }, []);

  // Handle follow-up questions
  const handleFollowUp = useCallback(async () => {
    if (!followUpInput.trim() || aiLoading) return;
    const input = followUpInput;
    setFollowUpInput("");
    await append({ role: "user", content: input });
  }, [followUpInput, append, aiLoading]);

  // Exit AI mode and go back to search
  const handleBackToSearch = useCallback(() => {
    setAiMode(false);
    setMessages([]);
    setQuery("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [setMessages]);

  // Check if cursor is at end of input
  const isCursorAtEnd = useCallback(() => {
    const input = inputRef.current;
    if (!input) return false;
    return input.selectionStart === input.value.length;
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (previewMode && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleBackFromPreview();
        return;
      }

      if (aiMode && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleBackToSearch();
        return;
      }

      const currentCommands = getCurrentCommands();
      const currentSelectedIndex = getCurrentSelectedIndex();

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const maxIndex = currentCommands.length > 0 ? currentCommands.length - 1 : 0;
        setSelectedIndices((prev) => {
          const next = [...prev];
          next[activeDepth] = Math.min((next[activeDepth] ?? 0) + 1, maxIndex);
          return next;
        });
        if (activeDepth === 0) {
          setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndices((prev) => {
          const next = [...prev];
          next[activeDepth] = Math.max((next[activeDepth] ?? 0) - 1, 0);
          return next;
        });
        if (activeDepth === 0) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        }
      } else if (e.key === "ArrowRight") {
        // Navigate deeper into nested preview
        if (activeDepth === 0 && !isCursorAtEnd()) {
          // Don't navigate if cursor is not at end of input
          return;
        }
        if (currentSelectedIndex >= 0 && currentSelectedIndex < currentCommands.length) {
          const selectedCommand = currentCommands[currentSelectedIndex];
          if (selectedCommand.preview) {
            e.preventDefault();
            // Call onFocus handlers - previews will register nested commands
            // and call navigateToNested() which sets activeDepth
            previewFocusHandlers.forEach((handler) => handler());
            // Note: navigateToNested() already sets activeDepth, so we don't do it here
          }
        }
      } else if (e.key === "ArrowLeft") {
        // Navigate back from nested preview
        if (activeDepth > 0) {
          e.preventDefault();
          const blurHandlerIndex = activeDepth - 1;
          if (blurHandlerIndex >= 0 && blurHandlerIndex < nestedBlurHandlers.length) {
            const blurHandler = nestedBlurHandlers[blurHandlerIndex];
            blurHandler();
          }
          // Go back one level and clear nested columns
          setActiveDepth((prev) => Math.max(prev - 1, 0));
          // Clear nested columns when going back to main list
          if (activeDepth === 1) {
            setNestedColumns([]);
            setNestedBlurHandlers([]);
          }
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (currentCommands.length > 0 && currentCommands[currentSelectedIndex]) {
          handleSelectCommand(currentCommands[currentSelectedIndex]);
        } else if (query.trim() && currentSelectedIndex === 0 && activeDepth === 0) {
          runAsynchronously(handleAskAI());
        }
      }
    },
    [
      handleSelectCommand,
      handleAskAI,
      aiMode,
      handleBackToSearch,
      handleBackFromPreview,
      previewMode,
      query,
      getCurrentCommands,
      getCurrentSelectedIndex,
      activeDepth,
      previewFocusHandlers,
      nestedBlurHandlers,
      isCursorAtEnd,
    ]
  );

  // Handle follow-up input keyboard
  const handleFollowUpKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        runAsynchronously(handleFollowUp());
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleBackToSearch();
      }
    },
    [handleFollowUp, handleBackToSearch]
  );

  if (!open) return null;

  const hasResults = filteredCommands.length > 0;
  const hasQuery = query.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        style={{ animation: "spotlight-fade-in 100ms ease-out" }}
        onClick={() => setOpen(false)}
      />

      {/* Spotlight Container */}
      <div
        className="fixed inset-0 flex items-center justify-center z-50 px-4 pointer-events-none"
        style={{ animation: "spotlight-slide-in 150ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="relative rounded-2xl ring-2 ring-inset ring-foreground/[0.08] h-[76vh] min-h-[320px] w-full max-w-[max(540px,75vw)] pointer-events-auto">
          {/* Background layer */}
          <div className="absolute inset-[2px] rounded-[14px] -z-10 backdrop-blur-xl bg-gray-100/80 dark:bg-[#161616]/80" />
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl h-full flex flex-col",
            )}
          >
            {/* AI Mode Header */}
            {aiMode && (
              <div className="flex items-center gap-2 px-5 py-3 border-b border-foreground/[0.06]">
                <button
                  onClick={handleBackToSearch}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 hover:transition-none"
                >
                  <span>←</span>
                  <span>Back to search</span>
                </button>
                <div className="flex-1" />
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-purple-500/10 text-purple-400 text-[10px] font-medium">
                  <Sparkles className="h-3 w-3" />
                  AI Assistant
                </div>
              </div>
            )}

            {/* Search Input */}
            {!aiMode && (
              <div className="flex items-center px-5 py-4">
                <Search className="mr-4 h-5 w-5 shrink-0 text-muted-foreground/70" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search or ask AI..."
                  className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/50"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            )}

            {/* AI Conversation */}
            {aiMode && (
              <div className="flex flex-col max-h-[480px]">
                {/* Messages */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-4"
                  style={{ scrollbarGutter: "stable" }}
                >
                  {messages.map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "flex gap-2.5",
                        message.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      {message.role === "assistant" && (
                        <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-purple-500/10 flex items-center justify-center">
                          <Sparkles className="h-3 w-3 text-purple-400" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "min-w-0 rounded-xl px-3.5 py-2",
                          message.role === "user"
                            ? "max-w-[80%] bg-blue-500/10 text-foreground"
                            : "max-w-[calc(100%-2rem)] bg-foreground/[0.02]"
                        )}
                      >
                        {message.role === "user" ? (
                          <p className="text-[13px] leading-relaxed break-words">{message.content}</p>
                        ) : (
                          <div className="min-w-0 overflow-hidden">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                      {message.role === "user" && (
                        <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-blue-500/10 flex items-center justify-center">
                          <User className="h-3 w-3 text-blue-400" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading indicator - only show when no assistant message is streaming */}
                  {aiLoading && !messages.some(m => m.role === "assistant" && m.content) && (
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

                  {/* Streaming indicator at the end */}
                  {aiLoading && messages.some(m => m.role === "assistant" && m.content) && (
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
                    Enter to send · Esc to go back
                  </p>
                </div>
              </div>
            )}

            {/* Results and Preview */}
            {previewMode && filteredCommands[selectedIndex]?.preview ? (
              // Mobile: Fullscreen preview
              <div className="border-t border-foreground/[0.06] flex-grow-1 h-full flex flex-col">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-foreground/[0.06]">
                  <button
                    onClick={handleBackFromPreview}
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 hover:transition-none"
                  >
                    <span>←</span>
                    <span>Back</span>
                  </button>
                  <div className="flex-1" />
                  <div className="text-xs text-muted-foreground">{filteredCommands[selectedIndex]?.label}</div>
                </div>
                <div className="flex-1 overflow-auto">
                  {React.createElement(filteredCommands[selectedIndex].preview!, {
                    isSelected: true,
                    query,
                    registerOnFocus,
                    unregisterOnFocus,
                    onBlur: handleBackFromPreview,
                    registerNestedCommands: registerNestedCommandsDepth0,
                    navigateToNested: navigateToNestedDepth1,
                    depth: 0,
                    pathname,
                  })}
                </div>
              </div>
            ) : (
              <div
                ref={columnsContainerRef}
                className={cn(
                  "border-t border-foreground/[0.06] flex-grow-1 h-full flex overflow-x-auto",
                  "md:flex-row flex-col"
                )}
                style={{ animation: "spotlight-results-in 100ms ease-out", scrollbarWidth: "thin" }}
              >
                {/* Main Results List */}
                <div className={cn(
                  "overflow-auto h-full",
                  nestedColumns.length > 0
                    ? "md:w-[300px] md:flex-shrink-0 md:border-r md:border-foreground/[0.06]"
                    : "md:w-full md:flex-1"
                )}>
                  <CmdKResultsList
                    commands={filteredCommands}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelectCommand}
                    onMouseEnter={setSelectedIndex}
                    pathname={pathname}
                    emptyMessage="Enter a search term or ask AI..."
                    isParentColumn={activeDepth > 0}
                  />
                </div>

                {/* Nested Columns */}
                {nestedColumns.map((commands, depth) => {
                  const columnDepth = depth + 1;
                  const isActive = columnDepth === activeDepth;
                  const columnSelectedIndex = selectedIndices[columnDepth] ?? 0;

                  return (
                    <div
                      key={depth}
                      className={cn(
                        "overflow-auto h-full flex-shrink-0 md:w-[300px] border-r border-foreground/[0.06]"
                      )}
                      style={depth === nestedColumns.length - 1 ? { animation: "spotlight-slide-in-from-right 200ms ease-out" } : undefined}
                    >
                      <CmdKResultsList
                        commands={commands}
                        selectedIndex={columnSelectedIndex}
                        onSelect={(cmd) => {
                          // Handle selection in nested column
                          const newSelectedIndices = [...selectedIndices];
                          newSelectedIndices[columnDepth] = commands.indexOf(cmd);
                          setSelectedIndices(newSelectedIndices);
                          handleSelectCommand(cmd);
                        }}
                        onMouseEnter={(index) => {
                          const newSelectedIndices = [...selectedIndices];
                          newSelectedIndices[columnDepth] = index;
                          setSelectedIndices(newSelectedIndices);
                        }}
                        pathname={pathname}
                        isParentColumn={columnDepth < activeDepth}
                      />
                    </div>
                  );
                })}

                {/* Hidden preview component - renders invisibly to register focus handlers */}
                {filteredCommands[selectedIndex]?.preview && nestedColumns.length === 0 && (
                  <div className="hidden">
                    {React.createElement(filteredCommands[selectedIndex].preview!, {
                      isSelected: true,
                      query,
                      registerOnFocus,
                      unregisterOnFocus,
                      onBlur: noopOnBlur,
                      registerNestedCommands: registerNestedCommandsDepth0,
                      navigateToNested: navigateToNestedDepth1,
                      depth: 0,
                      pathname,
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Inline styles for animations */}
      <style jsx global>{`
        @keyframes spotlight-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes spotlight-slide-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-8px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0) scale(1);
          }
        }
        @keyframes spotlight-results-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes spotlight-slide-in-from-right {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes spotlight-rainbow {
          0% { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>
    </>
  );
}

// Trigger button component that can be placed in the header
export function CmdKTrigger() {
  const mouseCursorRef = useRef<HTMLDivElement>(null);
  const mouseCursorParentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (mouseCursorRef.current && mouseCursorParentRef.current) {
        const rect = mouseCursorParentRef.current.getBoundingClientRect();
        mouseCursorRef.current.style.left = `${e.clientX - rect.left}px`;
        mouseCursorRef.current.style.top = `${e.clientY - rect.top}px`;
        mouseCursorRef.current.style.display = "block";
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div className="hidden sm:block">
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("spotlight-toggle"))}
        className={cn(
          "group relative flex items-center gap-3 h-9 px-4 min-w-[240px]",
          "rounded-[12px]",
          "ring-2 ring-inset ring-foreground/[0.06]",
          "transition-all duration-300 hover:transition-none",
          "hover:ring-blue-500/20 hover:shadow-[0_0_24px_rgba(59,130,246,0.15),inset_0_1px_0_rgba(255,255,255,0.05)]"
        )}
      >
        <div
          ref={mouseCursorParentRef}
          className={cn(
            "absolute inset-[2px] overflow-hidden rounded-[10px] -z-20",
            "group-hover:opacity-100 transition-opacity duration-300 group-hover:transition-none",
          )}
        >
          <div
            ref={mouseCursorRef}
            className={cn(
              "absolute w-32 h-32 group-hover:w-64 group-hover:h-64 transition-[width,height] duration-300",
              "bg-blue-500/40 blur-lg",
              "rounded-full",
              "pointer-events-none",
              "-translate-x-1/2 -translate-y-1/2",
              "hidden",
            )}
          />
        </div>
        <div className={cn(
          "absolute inset-1 rounded-[10px] -z-10",
          "backdrop-blur-xl bg-gray-100/75 dark:bg-[#161616]/75",
        )} />
        {/* Subtle shimmer effect on hover */}
        <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 group-hover:transition-none overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/[0.03] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
        </div>
        <Sparkles className="h-3.5 w-3.5 text-blue-400/40 group-hover:text-blue-400/70 transition-colors duration-300 group-hover:transition-none" />
        <span className="flex-1 text-left text-[13px] text-muted-foreground/60 group-hover:text-muted-foreground transition-colors duration-300 group-hover:transition-none">
          Command Bar
        </span>
        <div className="pointer-events-none flex items-center gap-1">
          <kbd className="flex h-5 min-w-[20px] select-none items-center justify-center rounded-md bg-foreground/[0.04] ring-1 ring-inset ring-foreground/[0.06] px-1.5 font-mono text-[10px] font-medium text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors duration-300 group-hover:transition-none">
            ⌘
          </kbd>
          <kbd className="flex h-5 min-w-[20px] select-none items-center justify-center rounded-md bg-foreground/[0.04] ring-1 ring-inset ring-foreground/[0.06] px-1.5 font-mono text-[10px] font-medium text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors duration-300 group-hover:transition-none">
            K
          </kbd>
        </div>
      </button>
    </div>
  );
}
