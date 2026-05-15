"use client";

import { SimpleTooltip } from "@/components/ui/simple-tooltip";
import { cn } from "@/lib/utils";
import {
  EyeIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useState, type KeyboardEvent } from "react";
import type { AiQueryChat } from "./use-ai-query-chat";

type AiQueryBarProps = {
  chat: AiQueryChat,
  /** Whether the AI has committed a query (drives the purple accent). */
  isActive: boolean,
  /** Invoked when the user clicks the eye button. */
  onOpenDialog: () => void,
  /** Invoked when the user clicks the reset (clear) button. */
  onReset: () => void,
};

/**
 * AI-powered search bar for the analytics tables page. Drops into the
 * DataGridToolbar in place of the built-in quick-search input. Typing
 * a message and pressing Enter sends a prompt to the shared AI chat;
 * the AI responds by calling the `queryAnalytics` tool, and the
 * extracted query drives the grid (via the parent component).
 */
export function AiQueryBar({
  chat,
  isActive,
  onOpenDialog,
  onReset,
}: AiQueryBarProps) {
  const [input, setInput] = useState("");

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || chat.isResponding) return;
    setInput("");
    runAsynchronously(chat.sendMessage({ text }));
  }, [input, chat]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <div
        className={cn(
          "group flex h-8 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 sm:max-w-72",
          "bg-background ring-1 transition-shadow",
          isActive
            ? "ring-purple-500/30 focus-within:ring-purple-500/50"
            : "ring-black/[0.08] dark:ring-white/[0.08] focus-within:ring-foreground/[0.18]",
        )}
      >
        <SparkleIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isActive ? "text-purple-400" : "text-muted-foreground/50",
          )}
        />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isActive ? "Refine with AI…" : "Ask about your analytics…"
          }
          className={cn(
            "min-w-0 flex-1 bg-transparent text-xs outline-none",
            "placeholder:text-muted-foreground/40",
          )}
          disabled={chat.isResponding}
        />
        {chat.isResponding && (
          <SpinnerGapIcon className="h-3 w-3 shrink-0 animate-spin text-purple-400" />
        )}
        {!chat.isResponding && input.trim().length > 0 && (
          <button
            type="button"
            onClick={handleSubmit}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-purple-400 transition-colors hover:transition-none"
            aria-label="Send"
          >
            <PaperPlaneTiltIcon className="h-3 w-3" />
          </button>
        )}
        <SimpleTooltip tooltip="Open AI query builder">
          <button
            type="button"
            onClick={onOpenDialog}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors hover:transition-none",
              isActive
                ? "text-purple-400 hover:text-purple-300"
                : "text-muted-foreground/60 hover:text-foreground",
            )}
            aria-label="Open AI query builder"
          >
            <EyeIcon className="h-3 w-3" />
          </button>
        </SimpleTooltip>
      </div>

      {isActive && (
        <SimpleTooltip tooltip="Clear AI query">
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors hover:transition-none"
            aria-label="Clear AI query"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </SimpleTooltip>
      )}
    </div>
  );
}
