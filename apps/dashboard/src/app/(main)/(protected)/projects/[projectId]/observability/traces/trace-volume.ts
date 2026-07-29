import { isDateValue, parseClickHouseDate } from "../../analytics/shared";
import type { ServiceIdentity } from "../service-identity";

export type TraceTimeRangeHours = 1 | 24 | 168 | 720;

export type TraceVolumeBucket = {
  bucketMs: number,
  count: number,
};

type TraceVolumeGranularity = {
  bucketLabel: string,
  bucketCount: number,
  historySql: string,
  startFunction: string,
  stepSql: string,
};

export function getTraceVolumeGranularity(hours: TraceTimeRangeHours): TraceVolumeGranularity {
  switch (hours) {
    case 1: {
      return {
        bucketLabel: "per minute",
        bucketCount: 60,
        historySql: "INTERVAL 59 MINUTE",
        startFunction: "toStartOfMinute",
        stepSql: "INTERVAL 1 MINUTE",
      };
    }
    case 24: {
      return {
        bucketLabel: "per hour",
        bucketCount: 24,
        historySql: "INTERVAL 23 HOUR",
        startFunction: "toStartOfHour",
        stepSql: "INTERVAL 1 HOUR",
      };
    }
    case 168: {
      return {
        bucketLabel: "per day",
        bucketCount: 7,
        historySql: "INTERVAL 6 DAY",
        startFunction: "toStartOfDay",
        stepSql: "INTERVAL 1 DAY",
      };
    }
    case 720: {
      return {
        bucketLabel: "per day",
        bucketCount: 30,
        historySql: "INTERVAL 29 DAY",
        startFunction: "toStartOfDay",
        stepSql: "INTERVAL 1 DAY",
      };
    }
  }
}

export function getTraceVolumeQuery(
  hours: TraceTimeRangeHours,
  service: ServiceIdentity | null,
): {
  query: string,
  params: Record<string, string | number>,
} {
  const granularity = getTraceVolumeGranularity(hours);
  const serviceCondition = service == null ? "" : `
  AND r.trace_id IN (
    SELECT trace_id
    FROM default.trace_services
    WHERE coalesce(service_namespace, '') = {serviceNamespace:String}
      AND service_name = {serviceName:String}
  )`;

  return {
    query: `
WITH
  ${granularity.startFunction}(now64(3)) AS range_end,
  range_end - ${granularity.historySql} AS range_start
SELECT
  ${granularity.startFunction}(r.started_at) AS bucket_start,
  count() AS trace_count
FROM default.trace_roots AS r
WHERE r.started_at >= range_start
  AND r.started_at < range_end + ${granularity.stepSql}
  AND r.span_type != '$http-client'${serviceCondition}
GROUP BY bucket_start
ORDER BY bucket_start ASC
WITH FILL
  FROM range_start
  TO range_end + ${granularity.stepSql}
  STEP ${granularity.stepSql}
`,
    params: service == null ? {} : {
      serviceNamespace: service.namespace,
      serviceName: service.name,
    },
  };
}

export function parseTraceVolumeRows(rows: Record<string, unknown>[]): TraceVolumeBucket[] {
  return rows.map((row) => {
    const bucketStart = row.bucket_start;
    const traceCount = typeof row.trace_count === "number"
      ? row.trace_count
      : typeof row.trace_count === "string"
        ? Number(row.trace_count)
        : Number.NaN;
    if (!isDateValue(bucketStart) || !Number.isSafeInteger(traceCount) || traceCount < 0) {
      throw new Error("Trace volume query returned an invalid bucket");
    }
    return {
      bucketMs: parseClickHouseDate(bucketStart).getTime(),
      count: traceCount,
    };
  });
}
