"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { AdminEmailOutbox, AdminSendAttemptError } from "@stackframe/stack";

type TimelineEvent = {
  id: string,
  label: string,
  timestamp: Date | null,
  color: "green" | "gray" | "red" | "orange" | "blue",
  detail?: string,
  isSmall?: boolean,
};

function buildTimelineEvents(email: AdminEmailOutbox): TimelineEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing union fields that may not exist on all variants
  const e = email as any;
  const events: TimelineEvent[] = [];

  events.push({
    id: "created",
    label: "Created",
    timestamp: email.createdAt,
    color: "green",
  });

  if (e.startedRenderingAt) {
    events.push({
      id: "rendering",
      label: "Rendering",
      timestamp: e.startedRenderingAt,
      color: "green",
    });
  }

  if (email.status === "render-error") {
    events.push({
      id: "render-error",
      label: "Render Error",
      timestamp: e.renderedAt,
      color: "red",
      detail: e.renderError,
    });
  } else if (e.renderedAt) {
    events.push({
      id: "rendered",
      label: "Rendered",
      timestamp: e.renderedAt,
      color: "green",
    });
  }

  if (e.hasRendered && (email.status === "scheduled" || e.startedSendingAt || e.deliveredAt)) {
    events.push({
      id: "scheduled",
      label: "Scheduled",
      timestamp: email.scheduledAt,
      color: "green",
    });
  }

  const attemptErrors: AdminSendAttemptError[] = email.sendAttemptErrors ?? [];
  for (const attempt of attemptErrors) {
    events.push({
      id: `retry-${attempt.attemptNumber}`,
      label: `Attempt ${attempt.attemptNumber} failed`,
      timestamp: new Date(attempt.timestamp),
      color: "red",
      detail: attempt.externalMessage || attempt.internalMessage,
      isSmall: true,
    });
  }

  if (e.startedSendingAt) {
    events.push({
      id: "sending",
      label: "Sending",
      timestamp: e.startedSendingAt,
      color: email.status === "server-error" ? "red" : "green",
    });
  }

  if (email.status === "server-error") {
    events.push({
      id: "server-error",
      label: "Server Error",
      timestamp: e.errorAt,
      color: "red",
      detail: e.serverError,
    });
  }

  if (e.deliveredAt) {
    events.push({
      id: "delivered",
      label: "Delivered",
      timestamp: e.deliveredAt,
      color: "green",
    });
  }

  if (email.status === "skipped") {
    events.push({
      id: "skipped",
      label: "Skipped",
      timestamp: e.skippedAt,
      color: "orange",
      detail: e.skippedReason,
    });
  }

  if (e.bouncedAt) {
    events.push({ id: "bounced", label: "Bounced", timestamp: e.bouncedAt, color: "red" });
  }

  if (e.deliveryDelayedAt) {
    events.push({ id: "delivery-delayed", label: "Delayed", timestamp: e.deliveryDelayedAt, color: "orange" });
  }

  if (e.openedAt) {
    events.push({ id: "opened", label: "Opened", timestamp: e.openedAt, color: "blue" });
  }

  if (e.clickedAt) {
    events.push({ id: "clicked", label: "Clicked", timestamp: e.clickedAt, color: "blue" });
  }

  if (e.markedAsSpamAt) {
    events.push({ id: "spam", label: "Spam", timestamp: e.markedAsSpamAt, color: "orange" });
  }

  const inProgressStatuses = ["paused", "preparing", "rendering", "scheduled", "queued", "sending"];
  if (inProgressStatuses.includes(email.status) && !events.some(ev => ev.id === email.status)) {
    events.push({
      id: "current",
      label: email.status === "paused" ? "Paused" : email.status.charAt(0).toUpperCase() + email.status.slice(1),
      timestamp: null,
      color: email.status === "paused" ? "orange" : "gray",
    });
  }

  return events;
}

const DOT_BG: Record<string, string> = {
  green: "bg-green-500",
  gray: "bg-gray-300 dark:bg-gray-500",
  red: "bg-red-500",
  orange: "bg-orange-400",
  blue: "bg-blue-500",
};

const DOT_BORDER: Record<string, string> = {
  green: "border-green-500",
  gray: "border-gray-300 dark:border-gray-500",
  red: "border-red-500",
  orange: "border-orange-400",
  blue: "border-blue-500",
};

const LINE_BG: Record<string, string> = {
  green: "bg-green-400/60",
  gray: "bg-gray-200 dark:bg-gray-700",
  red: "bg-red-400/60",
  orange: "bg-orange-300/60",
  blue: "bg-blue-400/60",
};

function formatTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EmailTimeline({ email }: { email: AdminEmailOutbox }) {
  const events = buildTimelineEvents(email);
  if (events.length === 0) return null;

  return (
    <div className="relative py-2">
      {events.map((event, i) => {
        const isCompleted = event.timestamp !== null;
        const isCurrent = !isCompleted || (i === events.length - 1 && event.color !== "gray");
        const isLast = i === events.length - 1;
        const isAlternate = i % 2 === 1;
        const dotSize = event.isSmall ? "w-2.5 h-2.5" : "w-3.5 h-3.5";

        return (
          <div key={event.id} className="relative flex items-stretch" style={{ minHeight: event.isSmall ? 40 : 52 }}>
            {/* Left content (label or timestamp depending on alternation) */}
            <div className="w-[90px] shrink-0 flex items-start justify-end pr-3 pt-0.5">
              {isAlternate ? (
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                  {event.timestamp ? formatTime(event.timestamp) : <span className="italic">now</span>}
                </span>
              ) : (
                <span className={cn("text-[11px] font-medium text-right whitespace-nowrap", !isCompleted && "text-muted-foreground")}>
                  {event.label}
                </span>
              )}
            </div>

            {/* Center: continuous bar + dot */}
            <div className="relative flex flex-col items-center shrink-0" style={{ width: 20 }}>
              {/* Dot */}
              <div className={cn(
                "rounded-full shrink-0 z-10 mt-0.5",
                dotSize,
                isCompleted ? DOT_BG[event.color] : `border-2 bg-background ${DOT_BORDER[event.color]}`,
                isCurrent && isLast && "ring-4 ring-blue-500/20 animate-pulse",
              )} />
              {/* Connector line to next event */}
              {!isLast && (
                <div
                  className={cn(
                    "flex-1 w-0.5 mt-0.5",
                    isCompleted ? LINE_BG[event.color] : "border-l border-dashed border-gray-300 dark:border-gray-600",
                  )}
                  style={isCompleted ? {} : { width: 0 }}
                />
              )}
            </div>

            {/* Right content (timestamp or label depending on alternation) */}
            <div className="flex-1 pl-3 pt-0.5 min-w-0">
              {isAlternate ? (
                <div>
                  <span className={cn("text-[11px] font-medium", !isCompleted && "text-muted-foreground")}>
                    {event.label}
                  </span>
                  {event.detail && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-1.5 text-[10px] text-red-500 cursor-help underline decoration-dotted">details</span>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="right" className="text-xs max-w-[280px]">
                          <p className="whitespace-pre-wrap break-words">{event.detail}</p>
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  )}
                </div>
              ) : (
                <div>
                  <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {event.timestamp ? formatTime(event.timestamp) : <span className="italic">now</span>}
                  </span>
                  {event.detail && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="ml-1.5 text-[10px] text-red-500 cursor-help underline decoration-dotted">details</span>
                      </TooltipTrigger>
                      <TooltipPortal>
                        <TooltipContent side="right" className="text-xs max-w-[280px]">
                          <p className="whitespace-pre-wrap break-words">{event.detail}</p>
                        </TooltipContent>
                      </TooltipPortal>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
