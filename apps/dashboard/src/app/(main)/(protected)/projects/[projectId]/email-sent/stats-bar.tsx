"use client";

import { cn } from "@/lib/utils";

export type StatsBarData = {
  sent: number,       // Green - includes sent, opened, clicked, delivery-delayed, skipped
  bounced: number,    // Striped red - distinguishes from solid red errors
  spam: number,       // Yellow
  errors: number,     // Solid red - server-error, render-error
  inProgress: number, // Gray - includes preparing, rendering, scheduled, queued, sending, paused
};

type StatsBarProps = {
  data: StatsBarData,
  className?: string,
};

/**
 * A horizontal stacked bar showing proportions of email statuses.
 * Colors:
 * - Green: successfully delivered (sent, opened, clicked, delivery-delayed, skipped)
 * - Striped red: bounced
 * - Yellow: marked as spam
 * - Solid red: errors (server-error, render-error)
 * - Gray: in-progress (preparing, rendering, scheduled, queued, sending, paused)
 */
export function StatsBar({ data, className }: StatsBarProps) {
  const total = data.sent + data.bounced + data.spam + data.errors + data.inProgress;

  if (total === 0) {
    return (
      <div className={cn("w-full", className)}>
        <div className="h-4 w-full rounded bg-gray-200" />
      </div>
    );
  }

  const sentPercent = (data.sent / total) * 100;
  const bouncedPercent = (data.bounced / total) * 100;
  const spamPercent = (data.spam / total) * 100;
  const errorsPercent = (data.errors / total) * 100;
  const inProgressPercent = (data.inProgress / total) * 100;

  return (
    <div className={cn("w-full", className)}>
      {/* Bar */}
      <div className="h-4 w-full rounded overflow-hidden flex">
        {sentPercent > 0 && (
          <div
            className="bg-green-500 h-full"
            style={{ width: `${sentPercent}%` }}
          />
        )}
        {bouncedPercent > 0 && (
          <div
            className="h-full"
            style={{
              width: `${bouncedPercent}%`,
              background: "repeating-linear-gradient(45deg, #ef4444, #ef4444 4px, #fca5a5 4px, #fca5a5 8px)",
            }}
          />
        )}
        {spamPercent > 0 && (
          <div
            className="bg-yellow-400 h-full"
            style={{ width: `${spamPercent}%` }}
          />
        )}
        {errorsPercent > 0 && (
          <div
            className="bg-red-500 h-full"
            style={{ width: `${errorsPercent}%` }}
          />
        )}
        {inProgressPercent > 0 && (
          <div
            className="bg-gray-400 h-full"
            style={{ width: `${inProgressPercent}%` }}
          />
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
        {data.sent > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span>sent</span>
          </div>
        )}
        {data.bounced > 0 && (
          <div className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: "repeating-linear-gradient(45deg, #ef4444, #ef4444 1px, #fca5a5 1px, #fca5a5 2px)" }}
            />
            <span>bounced</span>
          </div>
        )}
        {data.spam > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <span>spam</span>
          </div>
        )}
        {data.errors > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>errors</span>
          </div>
        )}
        {data.inProgress > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            <span>pending</span>
          </div>
        )}
      </div>
    </div>
  );
}
