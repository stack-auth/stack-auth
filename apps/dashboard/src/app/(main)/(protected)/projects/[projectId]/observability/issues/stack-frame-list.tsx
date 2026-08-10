"use client";

import { DesignAlert, DesignBadge } from "@/components/design-components";
import { cn } from "@/lib/utils";
import { CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { IssueFrame } from "./issues-data";
import {
  collapsedFramesLabel,
  frameFunctionLabel,
  frameLocationLabel,
  groupStackFrames,
  orderStackFrames,
  type StackFrameOrder,
} from "./stack-frames";

/**
 * The stack trace card.
 *
 * The rule this file exists to keep is **never blank**. A stack that parsed
 * into zero frames still shows the raw string; a stack that is entirely library
 * code still shows its frames (the collapsed group starts open); a frame with
 * no source context still shows its location. Every "nothing to render" path
 * below has a visible outcome, because a silently empty card is
 * indistinguishable from a page that failed to load.
 */

function FrameSourceContext({ context }: { context: NonNullable<IssueFrame["context"]> }) {
  const preStart = -context.pre.length;
  return (
    <div className="mt-1.5 overflow-x-auto rounded-lg bg-foreground/[0.03] ring-1 ring-foreground/[0.06]">
      <pre className="min-w-full py-1.5 font-mono text-[11px] leading-[1.6]">
        {context.pre.map((line, index) => (
          <div key={`pre-${preStart + index}`} className="px-3 text-muted-foreground/70">{line}</div>
        ))}
        <div className="bg-red-500/10 px-3 text-foreground">{context.line}</div>
        {context.post.map((line, index) => (
          <div key={`post-${index}`} className="px-3 text-muted-foreground/70">{line}</div>
        ))}
      </pre>
    </div>
  );
}

function StackFrameRow({ frame }: { frame: IssueFrame }) {
  return (
    <li className="px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-xs font-medium text-foreground">{frameFunctionLabel(frame)}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={frameLocationLabel(frame)}>
          {frameLocationLabel(frame)}
        </span>
        {frame.in_app && <DesignBadge label="App" color="blue" size="sm" />}
      </div>
      {frame.context != null && <FrameSourceContext context={frame.context} />}
    </li>
  );
}

function CollapsedFrameGroup({
  frames,
  defaultExpanded,
}: {
  frames: readonly IssueFrame[],
  defaultExpanded: boolean,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:transition-none hover:bg-foreground/[0.03] hover:text-foreground"
      >
        <CaretRightIcon className={cn("h-3 w-3 shrink-0", expanded && "rotate-90")} />
        {collapsedFramesLabel(frames)}
      </button>
      {expanded && (
        <ul className="divide-y divide-foreground/[0.05] border-t border-foreground/[0.05] bg-foreground/[0.015]">
          {frames.map((frame, index) => (
            <StackFrameRow key={`${frameLocationLabel(frame)}-${index}`} frame={frame} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function StackFrameList({
  frames,
  rawStack,
  order,
}: {
  frames: readonly IssueFrame[],
  /** `data.stack` as the SDK sent it. The fallback when parsing produced nothing. */
  rawStack: string | null,
  order: StackFrameOrder,
}) {
  if (frames.length === 0) {
    if (rawStack == null || rawStack.trim() === "") {
      return (
        <DesignAlert
          variant="info"
          title="No stack trace"
          description="This error arrived without a stack — typically a non-Error value thrown somewhere the runtime could not attach one."
        />
      );
    }
    return (
      <div className="space-y-3">
        <DesignAlert
          variant="info"
          title="Unparsed stack trace"
          description="This stack didn't match any known runtime format, so it is shown exactly as it arrived."
        />
        <pre className="overflow-x-auto rounded-xl bg-foreground/[0.03] p-3 font-mono text-[11px] leading-relaxed ring-1 ring-foreground/[0.06]">
          {rawStack}
        </pre>
      </div>
    );
  }

  const groups = groupStackFrames(orderStackFrames(frames, order));

  return (
    <ul className="divide-y divide-foreground/[0.06] overflow-hidden rounded-xl ring-1 ring-foreground/[0.08]">
      {groups.map((group) => (
        group.kind === "frame"
          ? <StackFrameRow key={`frame-${group.index}`} frame={group.frame} />
          : (
            <CollapsedFrameGroup
              key={`collapsed-${group.startIndex}`}
              frames={group.frames}
              defaultExpanded={group.defaultExpanded}
            />
          )
      ))}
    </ul>
  );
}
