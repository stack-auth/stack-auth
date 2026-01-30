import { upstash } from "@/lib/upstash";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import type { OutgoingRequest } from "@/generated/prisma/client";
import {
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupTuple,
} from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";


export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Poll outgoing requests and push to QStash",
    description:
      "Internal endpoint invoked by Vercel Cron to process pending outgoing requests.",
    tags: ["External DB Sync"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["GET"]).defined(),
    headers: yupObject({
      authorization: yupTuple([yupString()]).defined(),
    }).defined(),
    query: yupObject({
      maxDurationMs: yupNumber().integer().min(1).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      requests_processed: yupNumber().defined(),
    }).defined(),
  }),
  handler: async ({ headers, query }) => {
    const authHeader = headers.authorization[0];
    if (authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }

    const startTime = performance.now();
    const maxDurationMs = query.maxDurationMs ?? 3 * 60 * 1000;
    const pollIntervalMs = 50;
    const staleClaimIntervalMinutes = 5;

    let totalRequestsProcessed = 0;
    async function claimPendingRequests(): Promise<OutgoingRequest[]> {
      return await retryTransaction(globalPrismaClient, async (tx) => {
        const rows = await tx.$queryRaw<OutgoingRequest[]>`
          UPDATE "OutgoingRequest"
          SET "startedFulfillingAt" = NOW()
          WHERE "id" IN (
            SELECT id
            FROM "OutgoingRequest"
            WHERE "startedFulfillingAt" IS NULL
              OR "startedFulfillingAt" < NOW() - (${staleClaimIntervalMinutes} * INTERVAL '1 minute')
            ORDER BY "createdAt"
            LIMIT 100
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *;
        `;
        return rows;
      });
    }
    async function deleteOutgoingRequest(id: string): Promise<void> {
      await retryTransaction(globalPrismaClient, async (tx) => {
        await tx.outgoingRequest.delete({ where: { id } });
      });
    }
    async function releaseOutgoingRequest(id: string): Promise<void> {
      await retryTransaction(globalPrismaClient, async (tx) => {
        await tx.outgoingRequest.updateMany({
          where: { id, startedFulfillingAt: { not: null } },
          data: { startedFulfillingAt: null },
        });
      });
    }
    async function processRequests(requests: OutgoingRequest[]): Promise<number> {
      const results = await Promise.allSettled(
        requests.map(async (request) => {
          // Prisma JsonValue doesn't carry a precise shape for this JSON blob.
          const options = request.qstashOptions as any;
          const baseUrl = getEnvVariable("NEXT_PUBLIC_STACK_API_URL");

          let fullUrl = new URL(options.url, baseUrl).toString();

          // In dev/test, QStash runs in Docker so "localhost" won't work.
          // Replace with "host.docker.internal" to reach the host machine.
          if (getNodeEnvironment().includes("development") || getNodeEnvironment().includes("test")) {
            const url = new URL(fullUrl);
            if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
              url.hostname = "host.docker.internal";
              fullUrl = url.toString();
            }
          }


          await upstash.publishJSON({
            url: fullUrl,
            body: options.body,
          });

          await deleteOutgoingRequest(request.id);
        }),
      );

      let processed = 0;
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          processed++;
          continue;
        }
        captureError(
          "poller-iteration-error",
          result.reason,
        );
        await releaseOutgoingRequest(requests[index].id);
      }

      return processed;
    }

    while (performance.now() - startTime < maxDurationMs) {
      const pendingRequests = await claimPendingRequests();

      totalRequestsProcessed += await processRequests(pendingRequests);

      await wait(pollIntervalMs);
    }

    return {
      statusCode: 200,
      bodyType: "json" as const,
      body: {
        ok: true,
        requests_processed: totalRequestsProcessed,
      },
    };
  },
});
