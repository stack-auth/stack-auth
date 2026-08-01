import type { ObservabilityTimeRangeHours } from "./filters";

/**
 * How a time range is divided into buckets for the Observability strip charts
 * (the traces volume chart and the per-service sparklines).
 *
 * These lived twice and had already diverged: at the 7d range the traces chart
 * drew 7 one-day bars while the services sparklines drew 28 six-hour bars, so
 * the same window told two different stories about when something happened. The
 * finer bucketing wins — a daily bar hides the burst you opened the page to
 * find — which is why this is expressed with `toStartOfInterval(x, stepSql)`
 * rather than the named `toStartOfDay`/`toStartOfHour` helpers the traces chart
 * used: those cannot express a 6-hour bucket at all.
 * `toStartOfInterval(t, INTERVAL 1 HOUR)` is exactly `toStartOfHour(t)`, so the
 * ranges that already agreed are unchanged.
 */
export type BucketGranularity = {
  /** Chart caption, e.g. "per 6 hours". */
  label: string,
  /** The bucket in prose, for sentences like "N errors in the last 6 hours". */
  bucketNoun: string,
  bucketCount: number,
  /** Bucket width in ms, for client-side bucket alignment. */
  stepMs: number,
  /** ClickHouse interval literal for one bucket. */
  stepSql: string,
  /** ClickHouse interval literal covering every bucket BEFORE the current one. */
  historySql: string,
};

const HOUR_MS = 3_600_000;

export function getBucketGranularity(hours: ObservabilityTimeRangeHours): BucketGranularity {
  switch (hours) {
    case 1: {
      return {
        label: "per minute",
        bucketNoun: "minute",
        bucketCount: 60,
        stepMs: 60_000,
        stepSql: "INTERVAL 1 MINUTE",
        historySql: "INTERVAL 59 MINUTE",
      };
    }
    case 24: {
      return {
        label: "per hour",
        bucketNoun: "hour",
        bucketCount: 24,
        stepMs: HOUR_MS,
        stepSql: "INTERVAL 1 HOUR",
        historySql: "INTERVAL 23 HOUR",
      };
    }
    case 168: {
      return {
        label: "per 6 hours",
        bucketNoun: "6 hours",
        bucketCount: 28,
        stepMs: 6 * HOUR_MS,
        stepSql: "INTERVAL 6 HOUR",
        historySql: "INTERVAL 162 HOUR",
      };
    }
    case 720: {
      return {
        label: "per day",
        bucketNoun: "day",
        bucketCount: 30,
        stepMs: 24 * HOUR_MS,
        stepSql: "INTERVAL 1 DAY",
        historySql: "INTERVAL 29 DAY",
      };
    }
  }
}
