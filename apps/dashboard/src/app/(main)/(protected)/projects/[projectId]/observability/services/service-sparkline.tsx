"use client";

import { cn } from "@/lib/utils";
import { useMemo } from "react";
import type { ServiceTimelineBucket } from "./services-data";

/**
 * Request volume over the window with failing buckets tinted red.
 *
 * Two series are deliberately NOT stacked or overlaid as separate shapes: at
 * ~20px tall an error series is almost always invisible next to request volume,
 * which is the failure mode that makes most table sparklines decorative. Tinting
 * the bar instead means a single failing bucket is legible even when it carries
 * two orders of magnitude fewer errors than requests.
 */
export function ServiceSparkline({
  buckets,
  bucketLabel,
  className,
}: {
  buckets: readonly ServiceTimelineBucket[],
  bucketLabel: string,
  className?: string,
}) {
  const maximum = useMemo(
    () => Math.max(0, ...buckets.map((bucket) => bucket.requestCount)),
    [buckets],
  );
  const totals = useMemo(() => buckets.reduce(
    (accumulator, bucket) => ({
      requests: accumulator.requests + bucket.requestCount,
      errors: accumulator.errors + bucket.errorCount,
    }),
    { requests: 0, errors: 0 },
  ), [buckets]);

  if (buckets.length === 0) {
    return (
      <div className={cn("flex h-6 items-center", className)} aria-hidden="true">
        <span className="h-px w-full bg-foreground/10" />
      </div>
    );
  }

  return (
    <div
      className={cn("flex h-6 items-end gap-px", className)}
      role="img"
      aria-label={`${totals.requests.toLocaleString()} requests and ${totals.errors.toLocaleString()} errors, ${bucketLabel}`}
    >
      {buckets.map((bucket) => {
        const hasErrors = bucket.errorCount > 0;
        // Empty buckets still render a hairline so gaps read as "no traffic"
        // rather than as the chart having fewer points than its neighbours.
        const heightPercent = maximum === 0 || bucket.requestCount === 0
          ? 0
          : Math.max(12, (bucket.requestCount / maximum) * 100);
        return (
          <span
            key={bucket.bucketMs}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            {heightPercent === 0 ? (
              <span className="block h-px w-full rounded-full bg-foreground/10" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  "block w-full rounded-t-[1px]",
                  hasErrors ? "bg-red-500/80" : "bg-foreground/25",
                )}
                style={{ height: `${heightPercent}%` }}
                aria-hidden="true"
              />
            )}
          </span>
        );
      })}
    </div>
  );
}
