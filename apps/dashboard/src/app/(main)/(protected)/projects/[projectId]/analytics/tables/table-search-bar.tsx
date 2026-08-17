"use client";

import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowElbowDownLeftIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { RowData } from "../shared";
import type { QueryDataGridToolbarContext } from "./query-data-grid";
import { looksLikeNaturalLanguageQuery } from "./search-bar-logic";
import type { AiTableFilterChat } from "./use-ai-table-filter-chat";

const SEARCH_DEBOUNCE_MS = 250;

type TableSearchBarProps = {
  /** Extended toolbar context from QueryDataGrid (grid state + fetch state). */
  ctx: QueryDataGridToolbarContext<RowData>,
  /**
   * The query currently driving the grid. When it changes, the grid resets
   * its own state (incl. `quickSearch`), so the bar drops any typed-but-now
   * -stale search text to stay in sync.
   */
  queryKey: string,
  /** Chat thread powering the AI filter fallback. */
  chat: AiTableFilterChat,
  /** The validated AI row filter currently applied to the grid, or null. */
  activeFilterQuery: string | null,
  /** True when the AI committed a query that failed shape validation and was
   *  therefore NOT applied. */
  filterRejected: boolean,
  /** Sends a natural-language filter request to the AI. */
  onAiSubmit: (text: string) => void,
  /** Clears the AI row filter (back to the plain table). */
  onClearFilter: () => void,
};

/** Compact removable chip showing an active AI query/filter. */
function ActiveQueryChip({
  label,
  query,
  onClear,
  clearLabel,
}: {
  label: string,
  query: string,
  onClear: () => void,
  clearLabel: string,
}) {
  return (
    <SimpleTooltip
      tooltip={
        <pre className="max-w-80 whitespace-pre-wrap break-all font-mono text-[10px]">
          {query}
        </pre>
      }
    >
      <span className="flex h-6 min-w-0 shrink items-center gap-1 rounded-lg bg-purple-500/10 py-0.5 pl-2 pr-1 text-[11px] text-purple-600 ring-1 ring-purple-500/25 dark:text-purple-300 dark:ring-purple-400/25">
        <SparkleIcon className="h-3 w-3 shrink-0" />
        <span className="min-w-0 max-w-40 truncate">{label}</span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded p-0.5 text-purple-500/70 hover:bg-purple-500/15 hover:text-purple-500 transition-colors hover:transition-none dark:text-purple-300/70 dark:hover:text-purple-200"
          aria-label={clearLabel}
        >
          <XIcon className="h-3 w-3" />
        </button>
      </span>
    </SimpleTooltip>
  );
}

/**
 * Filter-first search bar for the analytics tables page. Drops into the
 * DataGridToolbar in place of the built-in quick-search input.
 *
 * - Typing applies a debounced substring (ILIKE) filter over the table via
 *   `state.quickSearch` — columns, sort, and pagination stay untouched.
 * - Input that a substring can't express (natural language, comparisons, or
 *   searches that came back empty) is routed to the AI on Enter; the AI
 *   responds with a row filter over the SAME table, shown as a removable
 *   chip. ⌘/Ctrl+Enter always asks the AI.
 */
export function TableSearchBar({
  ctx,
  queryKey,
  chat,
  activeFilterQuery,
  filterRejected,
  onAiSubmit,
  onClearFilter,
}: TableSearchBarProps) {
  const [input, setInput] = useState("");
  // The notice (AI text reply / rejection / error) the user has dismissed —
  // compared by content so a NEW notice shows again.
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);

  const { onChange } = ctx;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Grid query changed (AI filter/builder applied or cleared) → the grid
  // just reset its quickSearch, so typed text left in the input would look
  // applied when it isn't. Drop it and cancel any pending debounce.
  const prevQueryKeyRef = useRef(queryKey);
  useEffect(() => {
    if (prevQueryKeyRef.current === queryKey) return;
    prevQueryKeyRef.current = queryKey;
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setInput("");
  }, [queryKey]);

  const applyQuickSearch = useCallback(
    (value: string) => {
      onChange((s) =>
        s.quickSearch === value
          ? s
          : {
            ...s,
            quickSearch: value,
            // Reset to the first page — the filtered result set may not
            // reach the page the user had scrolled to.
            pagination: { ...s.pagination, pageIndex: 0 },
          },
      );
    },
    [onChange],
  );

  // Each keystroke re-runs the ClickHouse query, so writes to
  // `state.quickSearch` are debounced. Clearing skips the debounce — showing
  // the unfiltered table again should feel instant.
  const scheduleQuickSearch = useCallback(
    (value: string) => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        debounceRef.current = null;
        applyQuickSearch("");
        return;
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        applyQuickSearch(trimmed);
      }, SEARCH_DEBOUNCE_MS);
    },
    [applyQuickSearch],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) clearTimeout(debounceRef.current);
    };
  }, []);

  const flushQuickSearch = useCallback(() => {
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    applyQuickSearch(input.trim());
  }, [applyQuickSearch, input]);

  const trimmedInput = input.trim();
  const isNaturalLanguage = useMemo(
    () => looksLikeNaturalLanguageQuery(trimmedInput),
    [trimmedInput],
  );
  // The plain filter came back empty for exactly what's typed — a substring
  // match can't help, so offer the AI even for plain-looking terms.
  const zeroResults =
    trimmedInput.length > 0
    && ctx.state.quickSearch === trimmedInput
    && !ctx.isLoading
    && !ctx.isRefetching
    && ctx.rowCount === 0;
  const wantsAi = trimmedInput.length > 0 && (isNaturalLanguage || zeroResults);

  const submitAi = useCallback(() => {
    const text = input.trim();
    if (text.length === 0 || chat.isResponding) return;
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // The text is a question for the AI, not a substring to match.
    applyQuickSearch("");
    setInput("");
    setDismissedNotice(null);
    onAiSubmit(text);
  }, [input, chat.isResponding, applyQuickSearch, onAiSubmit]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) {
        submitAi();
        return;
      }
      if (wantsAi) {
        submitAi();
      } else {
        flushQuickSearch();
      }
    },
    [submitAi, flushQuickSearch, wantsAi],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      scheduleQuickSearch(value);
    },
    [scheduleQuickSearch],
  );

  const clearInput = useCallback(() => {
    setInput("");
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    applyQuickSearch("");
  }, [applyQuickSearch]);

  // Stored with the committed query so a rejected/text-only refinement cannot
  // relabel the still-active filter with the newer request.
  const activeFilterLabel = activeFilterQuery == null ? null : chat.latestQueryLabel;

  const rejectionMessage = filterRejected
    ? "The AI answered with a query that would change this table's columns, so it wasn't applied. Try rephrasing your request."
    : null;
  const notice = chat.error?.message ?? chat.assistantNote ?? rejectionMessage;
  const noticeVisible = notice != null && notice !== dismissedNotice;

  const isAiActive = activeFilterQuery != null;
  const placeholder = isAiActive
    ? "Search within results or refine with AI…"
    : "Search rows or ask AI…";

  return (
    // No flex-1 on the outer wrapper — a flex-1 search would swallow the
    // toolbar's leading cluster and push siblings (e.g. the row-count badge)
    // to the far right. Width lives on the input shell instead.
    <div className="relative flex min-w-0 items-center gap-1.5">
      <div
        className={cn(
          "group flex h-8 w-full min-w-0 items-center gap-2 rounded-xl px-2.5 sm:w-80",
          "border border-black/[0.08] dark:border-white/[0.06]",
          "bg-white dark:bg-background shadow-sm ring-1 ring-black/[0.08] dark:ring-white/[0.06] transition-shadow hover:transition-none",
          isAiActive
            ? "ring-purple-500/30 focus-within:ring-purple-500/50 dark:ring-purple-400/30 dark:focus-within:ring-purple-400/50"
            : "hover:ring-black/[0.12] dark:hover:ring-white/[0.1] focus-within:ring-foreground/[0.18]",
        )}
      >
        {chat.isResponding ? (
          <SpinnerGapIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-purple-400" />
        ) : wantsAi || isAiActive ? (
          <SparkleIcon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isAiActive ? "text-purple-400" : "text-purple-400/70",
            )}
          />
        ) : (
          <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
        )}
        <input
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-xs outline-none",
            "placeholder:text-muted-foreground/40",
          )}
          aria-label="Search rows or ask AI"
        />
        {input.length > 0 && !wantsAi && (
          <button
            type="button"
            onClick={clearInput}
            className="shrink-0 rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors hover:transition-none"
            aria-label="Clear search"
          >
            <XIcon className="h-3 w-3" />
          </button>
        )}
        {wantsAi && !chat.isResponding && (
          <SimpleTooltip
            tooltip={
              zeroResults && !isNaturalLanguage
                ? "No rows match — press Enter to ask AI instead"
                : "Press Enter to ask AI"
            }
          >
            <button
              type="button"
              onClick={submitAi}
              className="flex shrink-0 items-center gap-1 rounded-md bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-500 hover:bg-purple-500/20 transition-colors hover:transition-none dark:text-purple-300"
              aria-label="Ask AI"
            >
              Ask AI
              <ArrowElbowDownLeftIcon className="h-2.5 w-2.5" />
            </button>
          </SimpleTooltip>
        )}
      </div>

      {activeFilterQuery != null && activeFilterLabel != null && (
        <ActiveQueryChip
          label={activeFilterLabel}
          query={activeFilterQuery}
          onClear={onClearFilter}
          clearLabel="Clear AI filter"
        />
      )}

      {noticeVisible && (
        <div className="absolute left-0 top-full z-50 mt-1.5 flex w-max max-w-96 items-start gap-2 rounded-xl bg-white px-3 py-2 text-[11px] leading-relaxed text-foreground/80 shadow-lg ring-1 ring-black/[0.08] dark:bg-popover dark:ring-white/[0.1]">
          <SparkleIcon className="mt-0.5 h-3 w-3 shrink-0 text-purple-400" />
          <span className="min-w-0 whitespace-pre-wrap break-words">{notice}</span>
          <button
            type="button"
            onClick={() => setDismissedNotice(notice)}
            className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground transition-colors hover:transition-none"
            aria-label="Dismiss"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
