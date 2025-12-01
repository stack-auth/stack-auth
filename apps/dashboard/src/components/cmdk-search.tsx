"use client";

import { useRouter } from "@/components/router";
import { ALL_APPS_FRONTEND, getItemPath } from "@/lib/apps-frontend";
import { cn } from "@/lib/utils";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useChat } from "ai/react";
import {
    Blocks,
    Globe,
    KeyRound,
    Loader2,
    Search,
    Send,
    Settings,
    Sparkles,
    User,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type SearchItem = {
  id: string,
  name: string,
  href: string,
  icon: React.ComponentType<{ className?: string }>,
  category: string,
  keywords?: string[],
};

// Markdown components for rendering AI responses
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm text-foreground mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-sm text-foreground mb-3 pl-4 list-disc">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="text-sm text-foreground mb-3 pl-4 list-decimal">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
  code: ({ children, className }: { children?: React.ReactNode, className?: string }) => {
    const isInline = !className;
    return isInline ? (
      <code className="px-1 py-0.5 rounded bg-foreground/[0.08] text-xs font-mono">{children}</code>
    ) : (
      <code className="block p-3 rounded-lg bg-foreground/[0.05] text-xs font-mono overflow-x-auto">
        {children}
      </code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="mb-3 overflow-x-auto">{children}</pre>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ href, children }: { href?: string, children?: React.ReactNode }) => (
    <a
      href={href}
      className="text-blue-400 hover:underline"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto mb-3 rounded-lg border border-foreground/[0.08]">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-foreground/[0.05] border-b border-foreground/[0.08]">{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => (
    <tbody className="divide-y divide-foreground/[0.05]">{children}</tbody>
  ),
  tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-3 py-2 text-muted-foreground">{children}</td>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-semibold text-foreground mb-2">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-semibold text-foreground mb-2">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-foreground mb-2">{children}</h3>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-purple-500/50 pl-3 my-2 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-foreground/[0.08]" />,
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
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

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

  // Focus input when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setAiMode(false);
      setFollowUpInput("");
      setMessages([]);
      lastMessageCountRef.current = 0;
      isNearBottomRef.current = true;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open, setMessages]);

  // Build search items from enabled apps and navigation
  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    items.push({
      id: "overview",
      name: "Overview",
      href: `/projects/${projectId}`,
      icon: Globe,
      category: "Navigation",
      keywords: ["home", "dashboard", "main"],
    });

    for (const appId of enabledApps) {
      const app = ALL_APPS[appId];
      const appFrontend = ALL_APPS_FRONTEND[appId];
      if (!app || !appFrontend) continue;

      for (const navItem of appFrontend.navigationItems) {
        items.push({
          id: `${appId}-${navItem.displayName}`,
          name: navItem.displayName,
          href: getItemPath(projectId, appFrontend, navItem),
          icon: appFrontend.icon,
          category: app.displayName,
          keywords: [app.displayName.toLowerCase(), navItem.displayName.toLowerCase()],
        });
      }
    }

    items.push({
      id: "explore-apps",
      name: "Explore Apps",
      href: `/projects/${projectId}/apps`,
      icon: Blocks,
      category: "Settings",
      keywords: ["apps", "marketplace", "store", "install"],
    });

    items.push({
      id: "project-keys",
      name: "Project Keys",
      href: `/projects/${projectId}/project-keys`,
      icon: KeyRound,
      category: "Settings",
      keywords: ["api", "keys", "credentials", "secret"],
    });

    items.push({
      id: "project-settings",
      name: "Project Settings",
      href: `/projects/${projectId}/project-settings`,
      icon: Settings,
      category: "Settings",
      keywords: ["config", "configuration", "options"],
    });

    return items;
  }, [projectId, enabledApps]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return [];

    const searchLower = query.toLowerCase().trim();
    return searchItems.filter((item) => {
      if (item.name.toLowerCase().includes(searchLower)) return true;
      if (item.category.toLowerCase().includes(searchLower)) return true;
      if (item.keywords?.some((k) => k.includes(searchLower))) return true;
      return false;
    });
  }, [query, searchItems]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  const handleSelect = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

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

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (aiMode && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleBackToSearch();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const maxIndex = filteredItems.length > 0 ? filteredItems.length - 1 : 0;
        setSelectedIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems.length > 0 && filteredItems[selectedIndex]) {
          handleSelect(filteredItems[selectedIndex].href);
        } else if (query.trim() && selectedIndex === 0) {
          runAsynchronously(handleAskAI());
        }
      }
    },
    [filteredItems, selectedIndex, handleSelect, handleAskAI, aiMode, handleBackToSearch, query]
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

  const hasResults = filteredItems.length > 0;
  const showResults = query.trim().length > 0;

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
        className="fixed left-1/2 top-[12%] z-50 w-full max-w-[600px] -translate-x-1/2 px-4"
        style={{ animation: "spotlight-slide-in 150ms cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="relative">
          {/* Rainbow gradient border */}
          <div
            className="absolute -inset-[1px] rounded-2xl opacity-60 blur-[3px]"
            style={{
              backgroundImage: aiMode
                ? "linear-gradient(90deg, #8b5cf6, #ec4899, #8b5cf6)"
                : "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
              backgroundSize: "200% 100%",
              animation: "spotlight-rainbow 4s linear infinite",
            }}
          />
          {/* Inner glow layer */}
          <div
            className="absolute -inset-[1px] rounded-2xl opacity-40"
            style={{
              backgroundImage: aiMode
                ? "linear-gradient(90deg, #8b5cf6, #ec4899, #8b5cf6)"
                : "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
              backgroundSize: "200% 100%",
              animation: "spotlight-rainbow 4s linear infinite",
            }}
          />
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl",
              "bg-background/95 backdrop-blur-xl",
              "shadow-2xl"
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
              <div className="flex flex-col max-h-[500px]">
                {/* Messages */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto px-4 py-3 space-y-4"
                >
                  {messages.map((message, index) => (
                    <div
                      key={message.id || index}
                      className={cn(
                        "flex gap-3",
                        message.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      {message.role === "assistant" && (
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center">
                          <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[85%] rounded-2xl px-4 py-2.5",
                          message.role === "user"
                            ? "bg-blue-500/10 text-foreground"
                            : "bg-foreground/[0.03]"
                        )}
                      >
                        {message.role === "user" ? (
                          <p className="text-sm">{message.content}</p>
                        ) : (
                          <div className="prose prose-sm prose-invert max-w-none">
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
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center">
                          <User className="h-3.5 w-3.5 text-blue-400" />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {aiLoading && (
                    <div className="flex gap-3 justify-start">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-purple-500/10 flex items-center justify-center">
                        <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      </div>
                      <div className="bg-foreground/[0.03] rounded-2xl px-4 py-3">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Thinking...</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Error display */}
                  {aiError && (
                    <div className="text-sm text-red-400 px-4 py-2 bg-red-500/10 rounded-lg">
                      {aiError.message || "Failed to get AI response. Please try again."}
                    </div>
                  )}
                </div>

                {/* Follow-up input */}
                <div className="border-t border-foreground/[0.06] px-4 py-3">
                  <div className="flex items-center gap-2 rounded-xl bg-foreground/[0.03] px-3 py-2 ring-1 ring-foreground/[0.06] focus-within:ring-purple-500/30">
                    <input
                      ref={followUpInputRef}
                      type="text"
                      value={followUpInput}
                      onChange={(e) => setFollowUpInput(e.target.value)}
                      onKeyDown={handleFollowUpKeyDown}
                      placeholder="Ask a follow-up question..."
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
                      autoComplete="off"
                      disabled={aiLoading}
                    />
                    <button
                      onClick={() => runAsynchronously(handleFollowUp())}
                      disabled={!followUpInput.trim() || aiLoading}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        followUpInput.trim() && !aiLoading
                          ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                          : "text-muted-foreground/30"
                      )}
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/50 mt-2 text-center">
                    Press Enter to send • Esc to go back
                  </p>
                </div>
              </div>
            )}

            {/* Results */}
            {!aiMode && showResults && (
              <div
                className={cn("border-t border-foreground/[0.06]", "overflow-hidden")}
                style={{ animation: "spotlight-results-in 100ms ease-out" }}
              >
                {hasResults ? (
                  <div className="max-h-[320px] overflow-y-auto py-2 px-2">
                    {filteredItems.map((item, index) => {
                      const IconComponent = item.icon;
                      const isSelected = index === selectedIndex;
                      const isCurrentPage = pathname === item.href;

                      return (
                        <button
                          key={item.id}
                          onClick={() => handleSelect(item.href)}
                          onMouseEnter={() => setSelectedIndex(index)}
                          className={cn(
                            "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                            "transition-colors duration-75",
                            isSelected ? "bg-foreground/[0.06]" : "bg-transparent"
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-lg",
                              "bg-foreground/[0.05]"
                            )}
                          >
                            <IconComponent className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {item.name}
                            </div>
                            <div className="text-xs text-muted-foreground/70 truncate">
                              {item.category}
                            </div>
                          </div>
                          {isCurrentPage && (
                            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wide">
                              Current
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-2 px-2">
                    {/* Ask AI option */}
                    <button
                      onClick={() => runAsynchronously(handleAskAI())}
                      onMouseEnter={() => setSelectedIndex(0)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                        "transition-colors duration-75",
                        selectedIndex === 0
                          ? "bg-gradient-to-r from-purple-500/[0.15] to-purple-500/[0.08] ring-1 ring-purple-500/20"
                          : "bg-transparent hover:bg-foreground/[0.03]"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-9 w-9 items-center justify-center rounded-lg",
                          "bg-purple-500/10"
                        )}
                      >
                        <Sparkles className="h-4 w-4 text-purple-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          Ask AI: &quot;{query}&quot;
                        </div>
                        <div className="text-xs text-muted-foreground/70 truncate">
                          Get an AI-powered answer from Stack Auth docs
                        </div>
                      </div>
                      <kbd className="flex h-5 items-center justify-center rounded bg-foreground/[0.05] px-1.5 font-mono text-[10px] font-medium text-muted-foreground/60">
                        ↵
                      </kbd>
                    </button>
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
  return (
    <div className="relative hidden sm:block">
      {/* Rainbow gradient border */}
      <div
        className="absolute -inset-[1px] rounded-xl opacity-50 blur-[2px]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
          backgroundSize: "200% 100%",
          animation: "spotlight-rainbow 4s linear infinite",
        }}
      />
      {/* Inner glow layer */}
      <div
        className="absolute -inset-[1px] rounded-xl opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
          backgroundSize: "200% 100%",
          animation: "spotlight-rainbow 4s linear infinite",
        }}
      />
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("spotlight-toggle"))}
        className={cn(
          "relative group flex items-center gap-3 h-9 px-3 min-w-[280px] rounded-xl",
          "bg-background/95 backdrop-blur-sm",
          "text-sm text-muted-foreground",
          "transition-all duration-150 hover:transition-none"
        )}
      >
        <Search className="h-4 w-4 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors duration-150 group-hover:transition-none" />
        <span className="flex-1 text-left text-[13px] text-muted-foreground/70 group-hover:text-muted-foreground transition-colors duration-150 group-hover:transition-none">
          Search or ask AI...
        </span>
        <div className="pointer-events-none flex items-center gap-1">
          <kbd className="flex h-5 min-w-[20px] select-none items-center justify-center rounded bg-foreground/[0.05] px-1 font-mono text-[11px] font-medium text-muted-foreground/60">
            ⌘
          </kbd>
          <kbd className="flex h-5 min-w-[20px] select-none items-center justify-center rounded bg-foreground/[0.05] px-1 font-mono text-[11px] font-medium text-muted-foreground/60">
            K
          </kbd>
        </div>
      </button>
    </div>
  );
}
