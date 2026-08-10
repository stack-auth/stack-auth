import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  constants as perfConstants,
  monitorEventLoopDelay,
  PerformanceObserver,
  type IntervalHistogram,
} from "node:perf_hooks";
import inspector from "node:inspector";
import v8 from "node:v8";

export type SpanAggregate = {
  name: string;
  count: number;
  totalInclusiveDurationMs: number;
  totalExclusiveDurationMs: number;
};

export type BackendRuntimeDiagnostics = {
  eventLoopDelay: {
    minMs: number,
    maxMs: number,
    meanMs: number,
    p50Ms: number,
    p95Ms: number,
    p99Ms: number,
    p99_9Ms: number,
  },
  cpu: {
    userSeconds: number,
    systemSeconds: number,
  },
  heap: {
    usedBytes: number,
    totalBytes: number,
    rssBytes: number,
    externalBytes: number,
    arrayBufferBytes: number,
    spaces: Array<{
      name: string,
      sizeBytes: number,
      usedBytes: number,
      availableBytes: number,
      physicalSizeBytes: number,
    }>,
  },
  gc: {
    totalDurationMs: number,
    totalCount: number,
    scavenge: { durationMs: number, count: number },
    markSweep: { durationMs: number, count: number },
    incremental: { durationMs: number, count: number },
  },
};

const spanAggregationEnabled = getEnvVariable("HEXCLAVE_SPAN_AGGREGATION", "false") === "true";
const eventLoopHistogram: IntervalHistogram | undefined = spanAggregationEnabled
  ? monitorEventLoopDelay({ resolution: 20 })
  : undefined;
let previousCpuUsage = spanAggregationEnabled ? process.cpuUsage() : undefined;
const gcStats = {
  totalDurationMs: 0,
  totalCount: 0,
  scavenge: { durationMs: 0, count: 0 },
  markSweep: { durationMs: 0, count: 0 },
  incremental: { durationMs: 0, count: 0 },
};
const gcObserver: PerformanceObserver | undefined = spanAggregationEnabled
  ? new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const detail = entry.detail;
      if (detail == null || typeof detail !== "object" || !("kind" in detail)) continue;
      const kind = detail.kind;
      if (typeof kind !== "number") continue;

      gcStats.totalDurationMs += entry.duration;
      gcStats.totalCount++;
      if (kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) {
        gcStats.scavenge.durationMs += entry.duration;
        gcStats.scavenge.count++;
      } else if (kind === perfConstants.NODE_PERFORMANCE_GC_MAJOR) {
        gcStats.markSweep.durationMs += entry.duration;
        gcStats.markSweep.count++;
      } else if (kind === perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL) {
        gcStats.incremental.durationMs += entry.duration;
        gcStats.incremental.count++;
      }
    }
  })
  : undefined;

if (eventLoopHistogram != null) {
  eventLoopHistogram.enable();
}
if (gcObserver != null) {
  gcObserver.observe({ entryTypes: ["gc"] });
}

function durationMs(startTime: [number, number], endTime: [number, number]): number {
  return (endTime[0] - startTime[0]) * 1000 + (endTime[1] - startTime[1]) / 1_000_000;
}

class SpanAggregationProcessor implements SpanProcessor {
  private readonly aggregates = new Map<string, SpanAggregate>();
  private readonly childDurationBySpanId = new Map<string, number>();

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  onEnd(span: ReadableSpan): void {
    const spanId = span.spanContext().spanId;
    const inclusiveDurationMs = durationMs(span.startTime, span.endTime);
    const childDurationMs = this.childDurationBySpanId.get(spanId) ?? 0;
    const exclusiveDurationMs = Math.max(0, inclusiveDurationMs - childDurationMs);
    this.childDurationBySpanId.delete(spanId);

    const aggregate = this.aggregates.get(span.name);
    if (aggregate == null) {
      this.aggregates.set(span.name, {
        name: span.name,
        count: 1,
        totalInclusiveDurationMs: inclusiveDurationMs,
        totalExclusiveDurationMs: exclusiveDurationMs,
      });
    } else {
      aggregate.count += 1;
      aggregate.totalInclusiveDurationMs += inclusiveDurationMs;
      aggregate.totalExclusiveDurationMs += exclusiveDurationMs;
    }

    const parentSpanId = span.parentSpanContext?.spanId;
    if (parentSpanId != null) {
      this.childDurationBySpanId.set(
        parentSpanId,
        (this.childDurationBySpanId.get(parentSpanId) ?? 0) + inclusiveDurationMs,
      );
    }
  }

  onStart(): void {
    // Span durations are calculated when spans end; no start bookkeeping is required.
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  snapshot(): SpanAggregate[] {
    return Array.from(this.aggregates.values())
      .map((aggregate) => ({ ...aggregate }))
      .sort((left, right) => right.totalExclusiveDurationMs - left.totalExclusiveDurationMs);
  }

  reset(): void {
    this.aggregates.clear();
    this.childDurationBySpanId.clear();
  }
}

export const spanAggregationProcessor = new SpanAggregationProcessor();

export function isSpanAggregationEnabled(): boolean {
  return spanAggregationEnabled;
}

export function getSpanAggregates(reset = false): SpanAggregate[] {
  const aggregates = spanAggregationProcessor.snapshot();
  if (reset) {
    spanAggregationProcessor.reset();
  }
  return aggregates;
}

function histogramValue(value: number): number {
  return Number.isFinite(value) ? value / 1e6 : 0;
}

export function getBackendRuntimeDiagnostics(reset = false): BackendRuntimeDiagnostics {
  if (!spanAggregationEnabled || eventLoopHistogram == null) {
    return {
      eventLoopDelay: {
        minMs: 0,
        maxMs: 0,
        meanMs: 0,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        p99_9Ms: 0,
      },
      cpu: {
        userSeconds: 0,
        systemSeconds: 0,
      },
      heap: {
        usedBytes: 0,
        totalBytes: 0,
        rssBytes: 0,
        externalBytes: 0,
        arrayBufferBytes: 0,
        spaces: [],
      },
      gc: {
        totalDurationMs: 0,
        totalCount: 0,
        scavenge: { durationMs: 0, count: 0 },
        markSweep: { durationMs: 0, count: 0 },
        incremental: { durationMs: 0, count: 0 },
      },
    };
  }

  const cpuUsage = process.cpuUsage(previousCpuUsage);
  const memoryUsage = process.memoryUsage();
  const diagnostics = {
    eventLoopDelay: {
      minMs: histogramValue(eventLoopHistogram.min),
      maxMs: histogramValue(eventLoopHistogram.max),
      meanMs: histogramValue(eventLoopHistogram.mean),
      p50Ms: histogramValue(eventLoopHistogram.percentile(50)),
      p95Ms: histogramValue(eventLoopHistogram.percentile(95)),
      p99Ms: histogramValue(eventLoopHistogram.percentile(99)),
      p99_9Ms: histogramValue(eventLoopHistogram.percentile(99.9)),
    },
    cpu: {
      userSeconds: cpuUsage.user / 1e6,
      systemSeconds: cpuUsage.system / 1e6,
    },
    heap: {
      usedBytes: memoryUsage.heapUsed,
      totalBytes: memoryUsage.heapTotal,
      rssBytes: memoryUsage.rss,
      externalBytes: memoryUsage.external,
      arrayBufferBytes: memoryUsage.arrayBuffers,
      spaces: v8.getHeapSpaceStatistics().map((space) => ({
        name: space.space_name,
        sizeBytes: space.space_size,
        usedBytes: space.space_used_size,
        availableBytes: space.space_available_size,
        physicalSizeBytes: space.physical_space_size,
      })),
    },
    gc: {
      totalDurationMs: gcStats.totalDurationMs,
      totalCount: gcStats.totalCount,
      scavenge: { ...gcStats.scavenge },
      markSweep: { ...gcStats.markSweep },
      incremental: { ...gcStats.incremental },
    },
  };

  if (reset) {
    previousCpuUsage = process.cpuUsage();
    eventLoopHistogram.reset();
    gcStats.totalDurationMs = 0;
    gcStats.totalCount = 0;
    gcStats.scavenge.durationMs = 0;
    gcStats.scavenge.count = 0;
    gcStats.markSweep.durationMs = 0;
    gcStats.markSweep.count = 0;
    gcStats.incremental.durationMs = 0;
    gcStats.incremental.count = 0;
  }

  return diagnostics;
}

const CPU_PROFILE_SAMPLING_INTERVAL_US = 5_000;
const CPU_PROFILE_WINDOW_MS = 3 * 60 * 1000;
let cpuProfileSession: inspector.Session | undefined;
let cpuProfileStopTimer: NodeJS.Timeout | undefined;
let completedCpuProfile: string | null = null;

function inspectorPost<T>(session: inspector.Session, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (error, response) => {
      if (error != null) {
        reject(error);
      } else {
        resolve(response as T);
      }
    });
  });
}

export async function startBackendCpuProfile(): Promise<boolean> {
  if (!spanAggregationEnabled || cpuProfileSession != null) return false;
  const session = new inspector.Session();
  session.connect();
  try {
    await inspectorPost(session, "Profiler.enable");
    await inspectorPost(session, "Profiler.setSamplingInterval", {
      interval: CPU_PROFILE_SAMPLING_INTERVAL_US,
    });
    await inspectorPost(session, "Profiler.start");
    cpuProfileSession = session;
    completedCpuProfile = null;
    cpuProfileStopTimer = setTimeout(() => {
      runAsynchronously(stopBackendCpuProfile());
    }, CPU_PROFILE_WINDOW_MS);
    cpuProfileStopTimer.unref();
    return true;
  } catch (error) {
    session.disconnect();
    throw error;
  }
}

export async function stopBackendCpuProfile(): Promise<string | null> {
  const session = cpuProfileSession;
  if (session == null) return completedCpuProfile;
  cpuProfileSession = undefined;
  if (cpuProfileStopTimer != null) {
    clearTimeout(cpuProfileStopTimer);
    cpuProfileStopTimer = undefined;
  }
  try {
    const result = await inspectorPost<{ profile: unknown }>(session, "Profiler.stop");
    await inspectorPost(session, "Profiler.disable");
    completedCpuProfile = JSON.stringify(result.profile);
    return completedCpuProfile;
  } finally {
    session.disconnect();
  }
}
