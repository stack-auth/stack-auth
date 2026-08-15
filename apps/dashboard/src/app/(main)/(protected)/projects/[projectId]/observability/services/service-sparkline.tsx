"use client";

import { useMemo } from "react";
import { EventSparkline } from "../event-sparkline";
import type { ServiceTimelineBucket } from "./services-data";

/**
 * Request volume over the window with failing buckets tinted red.
 *
 * The drawing lives in `EventSparkline` (shared with Issues); what stays here
 * is the Services-specific decision about what a bar means. Two series are
 * deliberately NOT stacked or overlaid as separate shapes: at ~20px tall an
 * error series is almost always invisible next to request volume, which is the
 * failure mode that makes most table sparklines decorative. Tinting the
 * request bar instead means a single failing bucket is legible even when it
 * carries two orders of magnitude fewer errors than requests.
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
  const sparklineBuckets = useMemo(
    () => buckets.map((bucket) => ({
      key: bucket.bucketMs,
      value: bucket.requestCount,
      highlighted: bucket.errorCount > 0,
    })),
    [buckets],
  );
  const totals = useMemo(() => buckets.reduce(
    (accumulator, bucket) => ({
      requests: accumulator.requests + bucket.requestCount,
      errors: accumulator.errors + bucket.errorCount,
    }),
    { requests: 0, errors: 0 },
  ), [buckets]);

  return (
    <EventSparkline
      buckets={sparklineBuckets}
      ariaLabel={`${totals.requests.toLocaleString()} requests and ${totals.errors.toLocaleString()} errors, ${bucketLabel}`}
      className={className}
    />
  );
}
