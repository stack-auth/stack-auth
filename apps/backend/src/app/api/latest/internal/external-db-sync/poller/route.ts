import type { OutgoingRequest } from "@/generated/prisma/client";
import { getExternalDbSyncFusebox } from "@/lib/external-db-sync-metadata";
import { upstash } from "@/lib/upstash";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { traceSpan } from "@/utils/telemetry";
import {
  yupBoolean,
  yupNumber,
  yupObject,
  yupString,
  yupTuple,
} from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable, getNodeEnvironment } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";
import type { PublishBatchRequest } from "@upstash/qstash";

const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
const DIRECT_SYNC_ENV = "STACK_EXTERNAL_DB_SYNC_DIRECT";
const POLLER_CLAIM_LIMIT_ENV = "STACK_EXTERNAL_DB_SYNC_POLL_CLAIM_LIMIT";
const DEFAULT_POLL_CLAIM_LIMIT = 1000;

function parseMaxDurationMs(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_DURATION_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StatusError(400, "maxDurationMs must be a positive integer");
  }
  return parsed;
}

function directSyncEnabled(): boolean {
  return getEnvVariable(DIRECT_SYNC_ENV, "") === "true";
}

function getPollerClaimLimit(): number {
  const rawValue = getEnvVariable(POLLER_CLAIM_LIMIT_ENV, "");
  if (!rawValue) return DEFAULT_POLL_CLAIM_LIMIT;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StackAssertionError(
      `${POLLER_CLAIM_LIMIT_ENV} must be a positive integer. Received: ${JSON.stringify(rawValue)}`
    );
  }
  return parsed;
}

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
      authorization: yupTuple([yupString().defined()]).optional(),
    }).defined(),
    query: yupObject({
      maxDurationMs: yupString().optional(),
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
  handler: async ({ headers, query, auth }) => {
    const isAdmin = auth?.type === "admin" && auth.project.id === "internal";
    const authHeader = headers.authorization?.[0];
    if (!isAdmin && authHeader !== `Bearer ${getEnvVariable("CRON_SECRET")}`) {
      throw new StatusError(401, "Unauthorized");
    }


    return await traceSpan("external-db-sync.poller", async (span) => {
      const startTime = performance.now();
      const maxDurationMs = parseMaxDurationMs(query.maxDurationMs);
      const pollIntervalMs = 50;
      const staleClaimIntervalMinutes = 5;
      const pollerClaimLimit = getPollerClaimLimit();

      span.setAttribute("stack.external-db-sync.max-duration-ms", maxDurationMs);
      span.setAttribute("stack.external-db-sync.poll-interval-ms", pollIntervalMs);
      span.setAttribute("stack.external-db-sync.poller-claim-limit", pollerClaimLimit);
      span.setAttribute("stack.external-db-sync.direct-sync", directSyncEnabled());
      span.setAttribute("stack.external-db-sync.stale-claim-minutes", staleClaimIntervalMinutes);

      let totalRequestsProcessed = 0;
      let iterationCount = 0;

      async function claimPendingRequests(): Promise<OutgoingRequest[]> {
        return await traceSpan("external-db-sync.poller.claimPendingRequests", async (claimSpan) => {
          const requests = await globalPrismaClient.$queryRaw<OutgoingRequest[]>`
              UPDATE "OutgoingRequest"
              SET "startedFulfillingAt" = NOW()
              WHERE "id" IN (
                SELECT id
                FROM "OutgoingRequest"
                WHERE "startedFulfillingAt" IS NULL
                LIMIT ${pollerClaimLimit}
                FOR UPDATE SKIP LOCKED
              )
              RETURNING *;
            `;
          claimSpan.setAttribute("stack.external-db-sync.claimed-count", requests.length);
          return requests;
        });
      }

      async function deleteOutgoingRequest(id: string): Promise<void> {
        await retryTransaction(globalPrismaClient, async (tx) => {
          await tx.outgoingRequest.delete({ where: { id } });
        });
      }

      async function deleteOutgoingRequests(ids: string[]): Promise<void> {
        if (ids.length === 0) return;
        await retryTransaction(globalPrismaClient, async (tx) => {
          await tx.outgoingRequest.deleteMany({ where: { id: { in: ids } } });
        });
      }
      async function processRequest(request: OutgoingRequest): Promise<void> {
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
          flowControl: options.flowControl,
        });
        await deleteOutgoingRequest(request.id);
      }

      type UpstashRequest = PublishBatchRequest<unknown>;

      function buildUpstashRequest(request: OutgoingRequest): UpstashRequest {
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

        const flowControl = options.flowControl as UpstashRequest["flowControl"];

        return {
          url: fullUrl,
          body: options.body,
          ...(flowControl ? { flowControl } : {}),
        };
      }

      async function processRequests(requests: OutgoingRequest[]): Promise<number> {
        return await traceSpan({
          description: "external-db-sync.poller.processRequests",
          attributes: {
            "stack.external-db-sync.pending-count": requests.length,
            "stack.external-db-sync.direct-sync": directSyncEnabled(),
          },
        }, async (processSpan) => {
          let processed = 0;

          if (directSyncEnabled()) {
            for (const request of requests) {
              try {
                await processRequest(request);
                processed++;
              } catch (error) {
                processSpan.setAttribute("stack.external-db-sync.iteration-error", true);
                captureError("poller-iteration-error", error);
              }
            }
            processSpan.setAttribute("stack.external-db-sync.processed-count", processed);
            return processed;
          }

          if (requests.length === 0) {
            processSpan.setAttribute("stack.external-db-sync.processed-count", 0);
            return 0;
          }

          try {
            const batchPayload = requests.map(buildUpstashRequest);
            await upstash.batchJSON(batchPayload);
            await deleteOutgoingRequests(requests.map((request) => request.id));
            processSpan.setAttribute("stack.external-db-sync.processed-count", requests.length);
            return requests.length;
          } catch (error) {
            processSpan.setAttribute("stack.external-db-sync.iteration-error", true);
            captureError("poller-iteration-error", error);
            processSpan.setAttribute("stack.external-db-sync.processed-count", 0);
            return 0;
          }
        });
      }

      type PollerIterationResult = {
        stopReason: "disabled" | null,
        processed: number,
      };

      while (performance.now() - startTime < maxDurationMs) {
        const iterationResult = await traceSpan<PollerIterationResult>({
          description: "external-db-sync.poller.iteration",
          attributes: {
            "stack.external-db-sync.iteration": iterationCount + 1,
          },
        }, async (iterationSpan) => {
          const fusebox = await getExternalDbSyncFusebox();
          iterationSpan.setAttribute("stack.external-db-sync.poller-enabled", fusebox.pollerEnabled);
          if (!fusebox.pollerEnabled) {
            return { stopReason: "disabled", processed: 0 };
          }

          const pendingRequests = await claimPendingRequests();
          iterationSpan.setAttribute("stack.external-db-sync.pending-count", pendingRequests.length);

          const processed = await processRequests(pendingRequests);
          iterationSpan.setAttribute("stack.external-db-sync.processed-count", processed);
          return { stopReason: null, processed };
        });

        iterationCount++;
        totalRequestsProcessed += iterationResult.processed;

        await wait(pollIntervalMs);
      }

      span.setAttribute("stack.external-db-sync.requests-processed", totalRequestsProcessed);
      span.setAttribute("stack.external-db-sync.iterations", iterationCount);

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          ok: true,
          requests_processed: totalRequestsProcessed,
        },
      };
    });
  },
});
