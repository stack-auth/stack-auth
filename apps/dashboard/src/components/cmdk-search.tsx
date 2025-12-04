"use client";

import { useRouter } from "@/components/router";
import { cn } from "@/lib/utils";
import { type AppId } from "@stackframe/stack-shared/dist/apps/apps-config";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import {
  Layout,
  Play,
  Search,
  Sparkles,
  User,
} from "lucide-react";
import { usePathname } from "next/navigation";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCmdKCommands, type CmdKCommand } from "./cmdk-commands";

// Example queries that cycle in the empty state
const EXAMPLE_QUERIES = [
  {
    query: "query all users from the last ten days",
    icon: User,
    iconColor: "text-blue-500",
    iconBg: "bg-blue-500/10",
  },
  {
    query: "how do i set up password authentication?",
    icon: Sparkles,
    iconColor: "text-purple-500",
    iconBg: "bg-purple-500/10",
  },
  {
    query: "create a game where my users are the enemies",
    icon: Play,
    iconColor: "text-amber-500",
    iconBg: "bg-amber-500/10",
  },
  {
    query: "create a dashboard for my users",
    icon: Layout,
    iconColor: "text-cyan-500",
    iconBg: "bg-cyan-500/10",
  },
];

// Feature highlights for empty state (similar to Apple Spotlight)
const FEATURE_HIGHLIGHTS = [
  {
    icon: Search,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
    title: "Search & Navigate",
    description: "Find pages, apps, and settings instantly.",
    exampleQuery: "authentication",
  },
  {
    icon: Sparkles,
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-500",
    title: "Ask AI",
    description: "Get answers from the Stack Auth documentation.",
    exampleQuery: "how do i set up password authentication?",
  },
  {
    icon: Play,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-500",
    title: "Vibecode Queries",
    description: "Execute queries using natural language.",
    exampleQuery: "query all users from the last ten days",
  },
];

// Cycling example query component
const CyclingExample = memo(function CyclingExample({
  onSelectQuery,
}: {
  onSelectQuery?: (query: string) => void,
}) {
  const [currentIndex, setCurrentIndex] = useState(() =>
    Math.floor(Math.random() * EXAMPLE_QUERIES.length)
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((currentIndex + 1) % EXAMPLE_QUERIES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [currentIndex]);

  return <>
    {EXAMPLE_QUERIES.map((example, index) => {
      return <button
        key={index}
        type="button"
        onClick={() => onSelectQuery?.(example.query)}
        className={cn(
          "flex flex-col items-center gap-1 cursor-pointer group",
          index === currentIndex ? "opacity-100" : "opacity-0",
          "transition-opacity duration-300"
        )}
      >
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", example.iconBg)}>
          <example.icon className={cn("h-4 w-4", example.iconColor)} />
        </div>
        <p className="text-[12px] text-muted-foreground/60 italic group-hover:text-muted-foreground transition-colors hover:transition-none">
          &ldquo;{example.query}&rdquo;
        </p>
      </button>;
    })}
  </>;
});

// Empty state placeholder component
const CyclingPlaceholder = memo(function CyclingPlaceholder({
  onSelectQuery,
}: {
  onSelectQuery?: (query: string) => void,
}) {
  return (
    <div className="h-full flex flex-col gap-4 items-center select-none px-6 pt-8 pb-4">

      <div className="flex-1" />

      {/* Welcome header */}
      <div className="relative text-center">
        {/* Keybind reminder - like tape on the corner */}
        <span className="absolute -top-4 -right-8 rotate-[30deg] flex items-center gap-0.5 text-[10px] text-muted-foreground/40">
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">⌘</kbd>
          +
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">K</kbd>
        </span>
        <h2 className="relative text-base font-semibold text-foreground mb-1 inline-block">
          Welcome to Control Center
        </h2>
        <p className="text-[11px] text-muted-foreground/50">
          Your shortcut to everything
        </p>
      </div>

      {/* Feature highlights with floating icons */}
      <div className="relative w-fit">
        {/* Floating decorative icons - left and right sides only */}
        <div className="absolute -left-6 top-0 w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center rotate-[-12deg] opacity-70">
          <Search className="h-4.5 w-4.5 text-blue-500" />
        </div>
        <div className="absolute -right-6 top-2 w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center rotate-[15deg] opacity-60">
          <Sparkles className="h-4 w-4 text-purple-500" />
        </div>
        <div className="absolute -left-16 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center rotate-[20deg] opacity-50">
          <User className="h-3.5 w-3.5 text-green-500" />
        </div>
        <div className="absolute -right-20 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-cyan-500/10 flex items-center justify-center rotate-[-8deg] opacity-60">
          <Layout className="h-4.5 w-4.5 text-cyan-500" />
        </div>
        <div className="absolute -left-7 bottom-0 w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center rotate-[8deg] opacity-50">
          <Play className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <div className="absolute -right-5 bottom-2 w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center rotate-[-18deg] opacity-50">
          <Sparkles className="h-4 w-4 text-rose-500" />
        </div>

        {/* Feature text content */}
        <div className="flex flex-col justify-center space-y-4 py-4 px-6 items-center">
          {FEATURE_HIGHLIGHTS.map((feature, index) => {
            return (
              <button
                key={index}
                type="button"
                onClick={() => onSelectQuery?.(feature.exampleQuery)}
                className="flex items-center gap-3 group cursor-pointer rounded-lg px-2 py-1 -mx-2 transition-colors hover:transition-none hover:bg-foreground/[0.04]"
              >
                <div className="flex-1 min-w-0 text-center">
                  <h3 className="text-[12px] font-medium text-foreground group-hover:text-foreground transition-colors hover:transition-none">
                    {feature.title}
                  </h3>
                  <p className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors hover:transition-none">
                    {feature.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="w-full max-w-[max(50vw,320px)] pt-4 mt-2 border-t border-foreground/[0.06]"></div>

      {/* Cycling example */}
      <div className="w-full max-w-[max(50vw,320px)]">
        <p className="text-[9px] text-muted-foreground/40 uppercase tracking-wider mb-2.5 text-center pointer-events-none">Try something like</p>
        <div className="flex justify-center">
          <CyclingExample onSelectQuery={onSelectQuery} />
        </div>
      </div>

      <div className="flex-1" />

      {/* Keyboard hints footer */}
      <div className="pt-4 mt-4 -mx-6 px-6 border-t border-foreground/[0.06] w-full flex items-center justify-center gap-5 text-[10px] text-muted-foreground/40">
        <div className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">⌘</kbd>
          +
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">K</kbd>
          <span>open</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">↑</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">↓</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">→</kbd>
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">←</kbd>
          <span>navigate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">↵</kbd>
          <span>select</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className="px-1.5 py-0.5 rounded bg-foreground/[0.06] font-mono">esc</kbd>
          <span>close</span>
        </div>
      </div>
    </div>
  );
});

// Reusable Results List Component
export const CmdKResultsList = memo(function CmdKResultsList({
  commands,
  selectedIndex,
  onSelect,
  onSetSelectedIndex,
  pathname,
  showCyclingPlaceholder = false,
  onSelectExampleQuery,
  isParentColumn = false,
}: {
  commands: CmdKCommand[],
  selectedIndex: number,
  onSelect: (cmd: CmdKCommand) => void,
  /** Called when clicking a row to update the selected index */
  onSetSelectedIndex?: (index: number) => void,
  pathname: string,
  /** Show the cycling placeholder with example queries */
  showCyclingPlaceholder?: boolean,
  /** Callback when an example query is selected from the placeholder */
  onSelectExampleQuery?: (query: string) => void,
  /** When true, selection shows as outline only (for parent columns) */
  isParentColumn?: boolean,
}) {
  const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const hasResults = commands.length > 0;

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = itemRefs.current.get(selectedIndex);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  if (!hasResults) {
    if (showCyclingPlaceholder) {
      return <CyclingPlaceholder onSelectQuery={onSelectExampleQuery} />;
    }
    return null;
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
                  : cmd.highlightColor === "gold"
                    ? "bg-gradient-to-r from-amber-500/[0.15] to-amber-500/[0.08] ring-1 ring-amber-500/20"
                    : cmd.highlightColor === "cyan"
                      ? "bg-gradient-to-r from-cyan-500/[0.15] to-cyan-500/[0.08] ring-1 ring-cyan-500/20"
                      : cmd.highlightColor === "app"
                        ? "bg-gray-100 dark:bg-gray-800/80"
                        : "bg-foreground/[0.06]"
            : "bg-foreground/[0.06]"
          : null;

        return (
          <button
            key={cmd.id}
            ref={(el) => {
              if (el) {
                itemRefs.current.set(index, el);
              } else {
                itemRefs.current.delete(index);
              }
            }}
            tabIndex={-1}
            onClick={() => {
              // Set the selected index first (important for focus-type actions)
              onSetSelectedIndex?.(index);
              onSelect(cmd);
            }}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left",
              "transition-colors duration-75 hover:transition-none",
              parentSelectionStyle,
              activeSelectionStyle,
              !isSelected && "bg-transparent hover:bg-foreground/[0.04]"
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
                      : cmd.highlightColor === "gold"
                        ? "bg-amber-500/10"
                        : cmd.highlightColor === "cyan"
                          ? "bg-cyan-500/10"
                          : cmd.highlightColor === "app"
                            ? "bg-gradient-to-br from-slate-200 to-slate-300 dark:from-[#1a3a5c] dark:to-[#0d1117]"
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

export function CmdKSearch({
  projectId,
  enabledApps,
  onEnableApp,
}: {
  projectId: string,
  enabledApps: AppId[],
  onEnableApp?: (appId: AppId) => Promise<void>,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
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
  const columnsContainerRef = useRef<HTMLDivElement>(null);

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
      setPreviewMode(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  // Get commands from the hook
  const commands = useCmdKCommands({ projectId, enabledApps, query, onEnableApp });

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return [];

    const searchLower = query.toLowerCase().trim();
    return commands.filter((cmd) => {
      // AI and Run Query commands are always included when there's a query
      if (cmd.id === "ai/ask") return true;
      if (cmd.id === "query/run") return true;
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

  const registerOnFocus = useCallback((onFocus: () => void) => {
    setPreviewFocusHandlers((prev) => new Set(prev).add(onFocus));
    // If there's a pending focus action (from clicking before preview mounted), trigger it now
    if (pendingFocusRef.current) {
      pendingFocusRef.current = false;
      // Defer to next frame to ensure state has settled
      requestAnimationFrame(() => {
        onFocus();
      });
    }
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

  // Handle blur from preview - focus the main search input
  const handlePreviewBlur = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  // Handle selection change from clicking - clears nested state synchronously
  const handleSetSelectedIndex = useCallback((index: number) => {
    // Clear nested state synchronously when selection changes via click
    // This is important because useEffect runs after render, but we need
    // the nested columns cleared BEFORE the next render so the preview can mount
    setNestedColumns([]);
    setSelectedIndices([index]);
    setNestedBlurHandlers([]);
    setPreviewFocusHandlers(new Set()); // Clear stale focus handlers from previous command
    setActiveDepth(0);
    setSelectedIndex(index);
  }, []);

  // Track pending focus action to handle click-then-focus timing
  const pendingFocusRef = useRef(false);

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
            // If handlers exist, call them immediately; otherwise mark pending for when preview mounts
            if (previewFocusHandlers.size > 0) {
              previewFocusHandlers.forEach((handler) => handler());
            } else {
              // Preview hasn't mounted yet (e.g., clicking from a different command)
              // Mark as pending so we can call focus when the preview registers its handler
              pendingFocusRef.current = true;
            }
          }
        }
      }
    },
    [router, previewFocusHandlers]
  );

  const handleBackFromPreview = useCallback(() => {
    setPreviewMode(false);
  }, []);

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

      const currentCommands = getCurrentCommands();
      const currentSelectedIndex = getCurrentSelectedIndex();

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const maxIndex = currentCommands.length > 0 ? currentCommands.length - 1 : 0;

        if (activeDepth === 0) {
          // Main list navigation - clear nested state
          const nextIndex = Math.min(selectedIndex + 1, maxIndex);
          if (nextIndex !== selectedIndex) {
            setSelectedIndex(nextIndex);
            setSelectedIndices([nextIndex]);
            setNestedColumns([]);
            setNestedBlurHandlers([]);
          }
        } else {
          // Nested list navigation
          setSelectedIndices((prev) => {
            const next = [...prev];
            next[activeDepth] = Math.min((next[activeDepth] ?? 0) + 1, maxIndex);
            return next;
          });
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();

        if (activeDepth === 0) {
          // Main list navigation - clear nested state
          const nextIndex = Math.max(selectedIndex - 1, 0);
          if (nextIndex !== selectedIndex) {
            setSelectedIndex(nextIndex);
            setSelectedIndices([nextIndex]);
            setNestedColumns([]);
            setNestedBlurHandlers([]);
          }
        } else {
          // Nested list navigation
          setSelectedIndices((prev) => {
            const next = [...prev];
            next[activeDepth] = Math.max((next[activeDepth] ?? 0) - 1, 0);
            return next;
          });
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
            // On mobile, show preview fullscreen (same as clicking a focus action)
            if (typeof window !== "undefined" && window.innerWidth < 768) {
              setPreviewMode(true);
            } else {
              // On desktop, call onFocus handlers - previews will register nested commands
              // and call navigateToNested() which sets activeDepth
              previewFocusHandlers.forEach((handler) => handler());
            }
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
        }
      }
    },
    [
      handleSelectCommand,
      handleBackFromPreview,
      previewMode,
      getCurrentCommands,
      getCurrentSelectedIndex,
      activeDepth,
      previewFocusHandlers,
      nestedBlurHandlers,
      isCursorAtEnd,
      selectedIndex,
    ]
  );

  if (!open) return null;

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
        <div className="relative rounded-2xl ring-2 ring-inset ring-foreground/[0.08] h-[76vh] min-h-[320px] w-full max-w-[min(max(540px,75vw),1000px)] pointer-events-auto">
          {/* Background layer */}
          <div className="absolute inset-[2px] rounded-[14px] -z-10 backdrop-blur-xl bg-gray-100/80 dark:bg-[#161616]/80" />
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl h-full flex flex-col",
            )}
          >
            {/* Search Input */}
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

            {/* Results and Preview */}
            {previewMode && filteredCommands[selectedIndex]?.preview ? (
              // Mobile: Fullscreen preview
              <div className="border-t border-foreground/[0.06] grow-1 h-full flex flex-col">
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
                  "border-t border-foreground/[0.06] grow-1 h-full flex overflow-x-auto",
                  "md:flex-row flex-col"
                )}
                style={{ animation: "spotlight-results-in 100ms ease-out", scrollbarWidth: "thin" }}
              >
                {/* Main Results List */}
                <div className={cn(
                  "overflow-auto h-full",
                  (nestedColumns.length > 0 || filteredCommands[selectedIndex]?.hasVisualPreview)
                    ? "md:w-[300px] md:flex-shrink-0"
                    : "md:w-full md:flex-1"
                )}>
                  <CmdKResultsList
                    commands={filteredCommands}
                    selectedIndex={selectedIndex}
                    onSelect={handleSelectCommand}
                    onSetSelectedIndex={handleSetSelectedIndex}
                    pathname={pathname}
                    showCyclingPlaceholder={true}
                    onSelectExampleQuery={setQuery}
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
                          handleSelectCommand(cmd);
                        }}
                        onSetSelectedIndex={(index) => {
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

                {/* Preview panel - shown on the right side when a command with visual preview is selected */}
                {(() => {
                  if (selectedIndex >= filteredCommands.length) return null;
                  const selectedCommand = filteredCommands[selectedIndex];
                  const showVisualPreview = selectedCommand.hasVisualPreview && selectedCommand.preview && nestedColumns.length === 0;
                  const showHiddenPreview = selectedCommand.preview && !selectedCommand.hasVisualPreview && nestedColumns.length === 0;

                  if (showVisualPreview) {
                    return (
                      <div className="hidden md:flex flex-1 border-l border-foreground/[0.06] overflow-hidden">
                        <div
                          key={`${selectedCommand.id}-${selectedIndex}`}
                          className="w-full h-full"
                          style={{ animation: "spotlight-preview-fade-in 150ms ease-out 100ms both" }}
                        >
                          {React.createElement(selectedCommand.preview!, {
                            isSelected: true,
                            query,
                            registerOnFocus,
                            unregisterOnFocus,
                            onBlur: handlePreviewBlur,
                            registerNestedCommands: registerNestedCommandsDepth0,
                            navigateToNested: navigateToNestedDepth1,
                            depth: 0,
                            pathname,
                          })}
                        </div>
                      </div>
                    );
                  }

                  if (showHiddenPreview) {
                    return (
                      <div className="hidden">
                        {React.createElement(selectedCommand.preview!, {
                          isSelected: true,
                          query,
                          registerOnFocus,
                          unregisterOnFocus,
                          onBlur: handlePreviewBlur,
                          registerNestedCommands: registerNestedCommandsDepth0,
                          navigateToNested: navigateToNestedDepth1,
                          depth: 0,
                          pathname,
                        })}
                      </div>
                    );
                  }

                  return null;
                })()}
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
            transform: translateY(-8px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
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
        @keyframes spotlight-preview-fade-in {
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
              "bg-blue-700/60 blur-lg",
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
          Control Center
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
