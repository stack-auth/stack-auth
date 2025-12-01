"use client";

import { useRouter } from "@/components/router";
import { ALL_APPS_FRONTEND, getItemPath } from "@/lib/apps-frontend";
import { cn } from "@/lib/utils";
import { ALL_APPS, type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useCompletion } from "ai/react";
import {
    Blocks,
    Globe,
    KeyRound,
    Loader2,
    Search,
    Settings,
    Sparkles,
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
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // AI completion hook
  const {
    completion,
    isLoading: aiLoading,
    complete: askAI,
    setCompletion,
    error: aiError,
  } = useCompletion({
    api: "/api/ai-search",
  });

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
      setCompletion("");
      // Small delay to ensure the element is mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open, setCompletion]);

  // Build search items from enabled apps and navigation
  const searchItems = useMemo(() => {
    const items: SearchItem[] = [];

    // Overview
    items.push({
      id: "overview",
      name: "Overview",
      href: `/projects/${projectId}`,
      icon: Globe,
      category: "Navigation",
      keywords: ["home", "dashboard", "main"],
    });

    // App items
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

    // Settings items
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

  // Handle AI search
  const handleAskAI = useCallback(() => {
    if (!query.trim()) return;
    setAiMode(true);
    setCompletion("");
    runAsynchronously(askAI(query));
  }, [query, askAI, setCompletion]);

  // Exit AI mode and go back to search
  const handleBackToSearch = useCallback(() => {
    setAiMode(false);
    setCompletion("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [setCompletion]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // In AI mode, Escape goes back to search
      if (aiMode && e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleBackToSearch();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        // +1 for the "Ask AI" option when no results
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
          // No results, ask AI
          handleAskAI();
        }
      }
    },
    [filteredItems, selectedIndex, handleSelect, handleAskAI, aiMode, handleBackToSearch, query]
  );

  if (!open) return null;

  const hasResults = filteredItems.length > 0;
  const showResults = query.trim().length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        style={{
          animation: "spotlight-fade-in 100ms ease-out",
        }}
        onClick={() => setOpen(false)}
      />

      {/* Spotlight Container */}
      <div
        className="fixed left-1/2 top-[18%] z-50 w-full max-w-[560px] -translate-x-1/2 px-4"
        style={{
          animation: "spotlight-slide-in 150ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
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
                  placeholder="Search..."
                  className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/50"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            )}

            {/* AI Response */}
            {aiMode && (
              <div
                ref={resultsRef}
                className="max-h-[400px] overflow-y-auto"
                style={{
                  animation: "spotlight-results-in 100ms ease-out",
                }}
              >
                {/* User query */}
                <div className="px-5 py-3 border-b border-foreground/[0.06]">
                  <div className="text-xs text-muted-foreground mb-1">You asked:</div>
                  <div className="text-sm text-foreground">{query}</div>
                </div>

                {/* AI Response */}
                <div className="px-5 py-4">
                  {aiError ? (
                    <div className="text-sm text-red-400">
                      {aiError.message || "Failed to get AI response. Please try again."}
                    </div>
                  ) : aiLoading && !completion ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking...
                    </div>
                  ) : completion ? (
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }: { children?: React.ReactNode }) => <p className="text-sm text-foreground mb-3 last:mb-0">{children}</p>,
                        ul: ({ children }: { children?: React.ReactNode }) => <ul className="text-sm text-foreground mb-3 pl-4 list-disc">{children}</ul>,
                        ol: ({ children }: { children?: React.ReactNode }) => <ol className="text-sm text-foreground mb-3 pl-4 list-decimal">{children}</ol>,
                        li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
                        code: ({ children, className }: { children?: React.ReactNode, className?: string }) => {
                          const isInline = !className;
                          return isInline ? (
                            <code className="px-1 py-0.5 rounded bg-foreground/[0.08] text-xs font-mono">{children}</code>
                          ) : (
                            <code className="block p-3 rounded-lg bg-foreground/[0.05] text-xs font-mono overflow-x-auto">{children}</code>
                          );
                        },
                        pre: ({ children }: { children?: React.ReactNode }) => <pre className="mb-3 overflow-x-auto">{children}</pre>,
                        strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
                        a: ({ href, children }: { href?: string, children?: React.ReactNode }) => (
                          <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                        // Table components
                        table: ({ children }: { children?: React.ReactNode }) => (
                          <div className="overflow-x-auto mb-3 rounded-lg border border-foreground/[0.08]">
                            <table className="w-full text-xs">{children}</table>
                          </div>
                        ),
                        thead: ({ children }: { children?: React.ReactNode }) => (
                          <thead className="bg-foreground/[0.05] border-b border-foreground/[0.08]">{children}</thead>
                        ),
                        tbody: ({ children }: { children?: React.ReactNode }) => <tbody className="divide-y divide-foreground/[0.05]">{children}</tbody>,
                        tr: ({ children }: { children?: React.ReactNode }) => <tr>{children}</tr>,
                        th: ({ children }: { children?: React.ReactNode }) => (
                          <th className="px-3 py-2 text-left font-semibold text-foreground whitespace-nowrap">{children}</th>
                        ),
                        td: ({ children }: { children?: React.ReactNode }) => (
                          <td className="px-3 py-2 text-muted-foreground">{children}</td>
                        ),
                        // Headers
                        h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-semibold text-foreground mb-2">{children}</h1>,
                        h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-semibold text-foreground mb-2">{children}</h2>,
                        h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold text-foreground mb-2">{children}</h3>,
                        // Block quote
                        blockquote: ({ children }: { children?: React.ReactNode }) => (
                          <blockquote className="border-l-2 border-purple-500/50 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
                        ),
                        // Horizontal rule
                        hr: () => <hr className="my-3 border-foreground/[0.08]" />,
                      }}
                    >
                      {completion}
                    </ReactMarkdown>
                      {aiLoading && (
                        <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5" />
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Results */}
            {!aiMode && showResults && (
              <div
                className={cn(
                "border-t border-foreground/[0.06]",
                "overflow-hidden"
              )}
                style={{
                  animation: "spotlight-results-in 100ms ease-out",
                }}
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
                          isSelected
                            ? "bg-foreground/[0.06]"
                            : "bg-transparent"
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
                      onClick={handleAskAI}
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
                          Get an AI-powered answer
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
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
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
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes spotlight-rainbow {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
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
          background: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
          backgroundSize: "200% 100%",
          animation: "spotlight-rainbow 4s linear infinite",
        }}
      />
      {/* Inner glow layer */}
      <div
        className="absolute -inset-[1px] rounded-xl opacity-30"
        style={{
          background: "linear-gradient(90deg, #f97316, #ec4899, #8b5cf6, #3b82f6, #06b6d4, #10b981, #f97316)",
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
          Search pages...
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
