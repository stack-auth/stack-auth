"use client";

import { cn } from "@/components/ui";
import { type ToolCallContentPartProps } from "@assistant-ui/react";
import { CheckIcon, ShieldCheckIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { resolveApproval } from "../approval-store";

/**
 * Rendered for the copilot's `request-approval` tool call. The adapter pauses
 * mid-stream until the operator approves or declines; the resolution flows
 * back through the approval store.
 */
export function ApprovalCard({ toolCallId, args, result }: ToolCallContentPartProps) {
  const info = args as { action?: string, summary?: string };
  const outcome = (result ?? undefined) as { approved?: boolean } | undefined;
  const pending = outcome === undefined;

  // The card is the blocking decision — pin the thread viewport to the bottom
  // so it sits right above the composer instead of clipped out of view.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pending) return;
    const viewport = rootRef.current?.closest(".overflow-y-auto");
    if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
  }, [pending]);

  return (
    <div
      ref={rootRef}
      className={cn(
        "my-2 rounded-lg bg-foreground/[0.03] px-3 py-2.5 ring-1",
        pending ? "ring-purple-500/25" : "ring-foreground/[0.08]",
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldCheckIcon className="h-3.5 w-3.5 shrink-0 text-purple-400/80" />
        <span className="text-[12px] font-medium text-foreground/90">{info.action ?? "Agent action"}</span>
        {!pending && (
          <span className={cn("ml-auto text-[10px]", outcome.approved ? "text-green-500/80" : "text-muted-foreground/60")}>
            {outcome.approved ? "Approved" : "Declined"}
          </span>
        )}
      </div>
      {info.summary && (
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{info.summary}</p>
      )}
      {pending && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => resolveApproval(toolCallId, true)}
            className="flex h-6 items-center gap-1 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background transition-colors hover:bg-foreground/90"
          >
            <CheckIcon className="h-3 w-3" />
            Approve
          </button>
          <button
            type="button"
            onClick={() => resolveApproval(toolCallId, false)}
            className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground/80"
          >
            <XIcon className="h-3 w-3" />
            Decline
          </button>
        </div>
      )}
    </div>
  );
}
