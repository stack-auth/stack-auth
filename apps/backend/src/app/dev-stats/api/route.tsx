import {
  clearRequestStats,
  getAggregateStats,
  getMostCommonRequests,
  getMostTimeConsumingRequests,
  getSlowestRequests,
} from "@/lib/dev-request-stats";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
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

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
