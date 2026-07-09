"use client";

import { FileTextIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { DemoConversation } from "../fixtures";

/**
 * AI-suggested docs edit, shown when repeated conversations trace back to the
 * same documentation gap. Mini diff, quiet colors.
 */
export function DocsSuggestionCard(props: { suggestion: NonNullable<DemoConversation["docsSuggestion"]> }) {
  const { suggestion } = props;
  const [applied, setApplied] = useState(false);

  return (
    <div className="shrink-0 border-b border-foreground/[0.06] px-4 py-3.5">
      <div className="flex items-center gap-2">
        <FileTextIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground/70">Suggested docs update</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{suggestion.reason}</p>
      <div className="mt-2 overflow-hidden rounded-lg bg-foreground/[0.02]">
        <div className="border-b border-foreground/[0.05] px-2.5 py-1.5 text-[10px] text-muted-foreground/60">
          {suggestion.title}
        </div>
        <div className="space-y-px p-2 font-mono text-[10px] leading-relaxed">
          {suggestion.removed.map((line) => (
            <div key={line} className="rounded px-1.5 py-0.5 text-red-500/80 dark:text-red-400/80">
              - {line}
            </div>
          ))}
          {suggestion.added.map((line) => (
            <div key={line} className="whitespace-pre-wrap rounded px-1.5 py-0.5 text-green-600/90 dark:text-green-400/80">
              + {line}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {applied ? (
          <span className="text-[11px] text-muted-foreground/60">Draft PR opened against the docs repo</span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setApplied(true)}
              className="text-[11px] font-medium text-foreground/70 transition-colors hover:text-foreground"
            >
              Open docs PR
            </button>
            <button type="button" className="text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground/80">
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}
