import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  getBackendRuntimeDiagnostics,
  getSpanAggregates,
  isSpanAggregationEnabled,
  startBackendCpuProfile,
  stopBackendCpuProfile,
} from "@/utils/span-aggregation";
import { yupArray, yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Read backend span aggregation",
    description: "Internal diagnostic endpoint for aggregated backend span timings.",
    hidden: true,
  },
  request: yupObject({
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      authorization: yupTuple([yupString().defined()]).defined(),
    }).defined(),
    query: yupObject({
      reset: yupString().oneOf(["true", "false"]).optional(),
      profile: yupString().oneOf(["start", "stop"]).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      enabled: yupBoolean().defined(),
      spans: yupArray(yupObject({
        name: yupString().defined(),
        count: yupNumber().defined(),
        totalInclusiveDurationMs: yupNumber().defined(),
        totalExclusiveDurationMs: yupNumber().defined(),
      }).defined()).defined(),
      runtime: yupObject({
        eventLoopDelay: yupObject({
          minMs: yupNumber().defined(),
          maxMs: yupNumber().defined(),
          meanMs: yupNumber().defined(),
          p50Ms: yupNumber().defined(),
          p95Ms: yupNumber().defined(),
          p99Ms: yupNumber().defined(),
          p99_9Ms: yupNumber().defined(),
        }).defined(),
        cpu: yupObject({
          userSeconds: yupNumber().defined(),
          systemSeconds: yupNumber().defined(),
        }).defined(),
        heap: yupObject({
          usedBytes: yupNumber().defined(),
          totalBytes: yupNumber().defined(),
          rssBytes: yupNumber().defined(),
          externalBytes: yupNumber().defined(),
          arrayBufferBytes: yupNumber().defined(),
          spaces: yupArray(yupObject({
            name: yupString().defined(),
            sizeBytes: yupNumber().defined(),
            usedBytes: yupNumber().defined(),
            availableBytes: yupNumber().defined(),
            physicalSizeBytes: yupNumber().defined(),
          }).defined()).defined(),
        }).defined(),
        gc: yupObject({
          totalDurationMs: yupNumber().defined(),
          totalCount: yupNumber().defined(),
          scavenge: yupObject({
            durationMs: yupNumber().defined(),
            count: yupNumber().defined(),
          }).defined(),
          markSweep: yupObject({
            durationMs: yupNumber().defined(),
            count: yupNumber().defined(),
          }).defined(),
          incremental: yupObject({
            durationMs: yupNumber().defined(),
            count: yupNumber().defined(),
          }).defined(),
        }).defined(),
      }).defined(),
      cpuProfile: yupString().nullable().defined(),
    }).defined(),
  }),
  handler: async ({ headers, query }) => {
    if (headers.authorization[0] !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const enabled = isSpanAggregationEnabled();
    let cpuProfile: string | null = null;
    if (query.profile === "start") {
      await startBackendCpuProfile();
    } else if (query.profile === "stop") {
      cpuProfile = await stopBackendCpuProfile();
    }
    const spans = enabled ? getSpanAggregates(query.reset === "true") : [];
    const runtime = getBackendRuntimeDiagnostics(query.reset === "true");

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        enabled,
        // These totals are sums across concurrent requests, not a wall-time budget.
        spans,
        runtime,
        cpuProfile,
      },
    };
  },
});
