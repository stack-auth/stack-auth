import {
  clearPerfHistory,
  getAggregatePerfStats,
  getCurrentPerfSnapshot,
  getPerfHistory,
} from "@/lib/dev-perf-stats";
import {
  clearRequestStats,
  getAggregateStats,
  getMostCommonRequests,
  getMostTimeConsumingRequests,
  getSlowestRequests,
} from "@/lib/dev-request-stats";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupNumber, yupObject, yupRecord, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const requestStatSchema = yupObject({
  method: yupString().defined(),
  path: yupString().defined(),
  count: yupNumber().defined(),
  totalTimeMs: yupNumber().defined(),
  minTimeMs: yupNumber().defined(),
  maxTimeMs: yupNumber().defined(),
  lastCalledAt: yupNumber().defined(),
});

const aggregateStatsSchema = yupObject({
  totalRequests: yupNumber().defined(),
  totalTimeMs: yupNumber().defined(),
  uniqueEndpoints: yupNumber().defined(),
  averageTimeMs: yupNumber().defined(),
});

const pgPoolSingleStatsSchema = yupObject({
  total: yupNumber().defined(),
  idle: yupNumber().defined(),
  waiting: yupNumber().defined(),
});

const pgPoolStatsSchema = yupObject({
  pools: yupRecord(yupString().defined(), pgPoolSingleStatsSchema.defined()).defined(),
  total: yupNumber().defined(),
  idle: yupNumber().defined(),
  waiting: yupNumber().defined(),
}).nullable();

const eventLoopDelayStatsSchema = yupObject({
  minMs: yupNumber().defined(),
  maxMs: yupNumber().defined(),
  meanMs: yupNumber().defined(),
  p50Ms: yupNumber().defined(),
  p95Ms: yupNumber().defined(),
  p99Ms: yupNumber().defined(),
}).nullable();

const eventLoopUtilizationStatsSchema = yupObject({
  utilization: yupNumber().defined(),
  idle: yupNumber().defined(),
  active: yupNumber().defined(),
}).nullable();

const memoryStatsSchema = yupObject({
  heapUsedMB: yupNumber().defined(),
  heapTotalMB: yupNumber().defined(),
  rssMB: yupNumber().defined(),
  externalMB: yupNumber().defined(),
  arrayBuffersMB: yupNumber().defined(),
});

const perfSnapshotSchema = yupObject({
  timestamp: yupNumber().defined(),
  pgPool: pgPoolStatsSchema.defined(),
  eventLoopDelay: eventLoopDelayStatsSchema.defined(),
  eventLoopUtilization: eventLoopUtilizationStatsSchema.defined(),
  memory: memoryStatsSchema.defined(),
});

const perfAggregateSchema = yupObject({
  pgPool: yupObject({
    avgTotal: yupNumber().defined(),
    avgIdle: yupNumber().defined(),
    maxWaiting: yupNumber().defined(),
  }).nullable().defined(),
  eventLoopDelay: yupObject({
    avgP50Ms: yupNumber().defined(),
    avgP99Ms: yupNumber().defined(),
    maxP99Ms: yupNumber().defined(),
  }).nullable().defined(),
  eventLoopUtilization: yupObject({
    avgUtilization: yupNumber().defined(),
    maxUtilization: yupNumber().defined(),
  }).nullable().defined(),
  memory: yupObject({
    avgHeapUsedMB: yupNumber().defined(),
    avgRssMB: yupNumber().defined(),
    maxRssMB: yupNumber().defined(),
  }).defined(),
});

function assertDevelopmentMode() {
  if (getNodeEnvironment() !== "development") {
    throw new StatusError(403, "This endpoint is only available in development mode");
  }
}

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      aggregate: aggregateStatsSchema.defined(),
      mostCommon: yupArray(requestStatSchema.defined()).defined(),
      mostTimeConsuming: yupArray(requestStatSchema.defined()).defined(),
      slowest: yupArray(requestStatSchema.defined()).defined(),
      // Performance metrics
      perfCurrent: perfSnapshotSchema.defined(),
      perfHistory: yupArray(perfSnapshotSchema.defined()).defined(),
      perfAggregate: perfAggregateSchema.defined(),
    }).defined(),
  }),
  handler: async () => {
    assertDevelopmentMode();

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        aggregate: getAggregateStats(),
        mostCommon: getMostCommonRequests(20),
        mostTimeConsuming: getMostTimeConsumingRequests(20),
        slowest: getSlowestRequests(20),
        // Performance metrics
        perfCurrent: getCurrentPerfSnapshot(),
        perfHistory: getPerfHistory(),
        perfAggregate: getAggregatePerfStats(),
      },
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async () => {
    assertDevelopmentMode();

    clearRequestStats();
    clearPerfHistory();

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
