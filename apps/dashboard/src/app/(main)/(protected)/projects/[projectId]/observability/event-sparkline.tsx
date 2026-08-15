"use client";

import { cn } from "@/lib/utils";
import { useMemo } from "react";

/**
 * The bar-chart-in-a-table-cell shared by the Observability pages.
 *
 * Extracted from the Services page's request-volume sparkline when Issues
 * needed the same shape for per-issue occurrence volume. Deliberately generic
 * over "a bucket has a magnitude, and may or may not be worth tinting": the
 * two callers disagree about what a bar *means* (requests vs. error
 * occurrences) but not at all about how it should look, and the visual rules
 * below are the whole reason the component exists.
 */

export type EventSparklineBucket = {
  /** Stable React key — typically the bucket's start time in epoch millis. */
  key: string | number,
  value: number,
  /**
   * Tints this bar with the alert color. Services sets it for buckets that
   * contained errors; Issues leaves it unset because every bucket is errors
   * already (it uses `tone="error"` instead).
   */
  highlighted?: boolean,
};

export type EventSparklineTone = "neutral" | "error";

type ToneClasses = { base: string, highlighted: string };

const TONE_CLASSES = new Map<EventSparklineTone, ToneClasses>([
  ["neutral", { base: "bg-foreground/25", highlighted: "bg-red-500/80" }],
  // A series that is *entirely* errors must not be a wall of full-strength
  // red — at that saturation the eye can no longer read the shape, which is
  // the only thing a sparkline is for. Half-strength keeps the silhouette
  // legible while still coding the series as bad.
  ["error", { base: "bg-red-500/45", highlighted: "bg-red-500/85" }],
]);

function getToneClasses(tone: EventSparklineTone): ToneClasses {
  const classes = TONE_CLASSES.get(tone);
  if (classes == null) throw new Error(`Missing sparkline tone classes for "${tone}"`);
  return classes;
}

/**
 * A flat hairline occupying exactly the sparkline's height.
 *
 * Rendered both for "no data in this window" and for "the counts haven't
 * arrived yet". Sharing one shape is deliberate: the row's height must not
 * change when the sparkline resolves, because Issues loads sparklines in a
 * second request *after* the rows are already on screen and a reflow of every
 * row at that moment is far worse than a plain line for a few hundred ms.
 */
function SparklineHairline({ className, label }: { className?: string, label: string | null }) {
  return (
    <div
      className={cn("flex h-6 items-center", className)}
      {...(label == null ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
    >
      <span className="h-px w-full bg-foreground/10" />
    </div>
  );
}

export function EventSparkline({
  buckets,
  ariaLabel,
  tone = "neutral",
  pending = false,
  className,
}: {
  buckets: readonly EventSparklineBucket[],
  /** Describes the whole series; the bars themselves are decorative. */
  ariaLabel: string,
  tone?: EventSparklineTone,
  /** The series is still loading. Renders the hairline, announced as such. */
  pending?: boolean,
  className?: string,
}) {
  const maximum = useMemo(
    () => Math.max(0, ...buckets.map((bucket) => bucket.value)),
    [buckets],
  );
  const toneClasses = getToneClasses(tone);

  if (pending) return <SparklineHairline className={className} label="Loading activity" />;
  if (buckets.length === 0) return <SparklineHairline className={className} label={null} />;

  return (
    <div className={cn("flex h-6 items-end gap-px", className)} role="img" aria-label={ariaLabel}>
      {buckets.map((bucket) => {
        // Empty buckets still render a hairline so gaps read as "no traffic"
        // rather than as the chart having fewer points than its neighbours.
        const heightPercent = maximum === 0 || bucket.value === 0
          ? 0
          : Math.max(12, (bucket.value / maximum) * 100);
        return (
          <span key={bucket.key} className="flex h-full min-w-0 flex-1 items-end">
            {heightPercent === 0 ? (
              <span className="block h-px w-full rounded-full bg-foreground/10" aria-hidden="true" />
            ) : (
              <span
                className={cn(
                  "block w-full rounded-t-[1px]",
                  bucket.highlighted === true ? toneClasses.highlighted : toneClasses.base,
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
