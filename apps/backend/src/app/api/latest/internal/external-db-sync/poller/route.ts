import { upstash } from "@/lib/upstash";
import type { PublishBatchRequest } from "@upstash/qstash";
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
import { captureError, StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { wait } from "@stackframe/stack-shared/dist/utils/promises";

const DEFAULT_MAX_DURATION_MS = 3 * 60 * 1000;
const DIRECT_SYNC_ENV = "STACK_EXTERNAL_DB_SYNC_DIRECT";
const POLLER_CLAIM_LIMIT_ENV = "STACK_EXTERNAL_DB_SYNC_POLL_CLAIM_LIMIT";
const DEFAULT_POLL_CLAIM_LIMIT = 100;

function parseMaxDurationMs(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_DURATION_MS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new StatusError(400, "maxDurationMs must be a positive integer");
  }
  return parsed;
}

function parseStopWhenIdle(value: string | undefined): boolean {
  if (!value) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new StatusError(400, "stopWhenIdle must be 'true' or 'false'");
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

function getLocalApiBaseUrl(): string {
  const prefix = getEnvVariable("NEXT_PUBLIC_STACK_PORT_PREFIX", "81");
  return `http://localhost:${prefix}02`;
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
      authorization: yupTuple([yupString().defined()]).defined(),
    }).defined(),
    query: yupObject({
      maxDurationMs: yupString().optional(),
      stopWhenIdle: yupString().optional(),
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
    const maxDurationMs = parseMaxDurationMs(query.maxDurationMs);
    const stopWhenIdle = parseStopWhenIdle(query.stopWhenIdle);
    const pollIntervalMs = 50;
    const staleClaimIntervalMinutes = 5;
    const pollerClaimLimit = getPollerClaimLimit();

    let totalRequestsProcessed = 0;
    async function claimPendingRequests(): Promise<OutgoingRequest[]> {
      return await globalPrismaClient.$queryRaw<OutgoingRequest[]>`
          UPDATE "OutgoingRequest"
          SET "startedFulfillingAt" = NOW()
          WHERE "id" IN (
            SELECT id
            FROM "OutgoingRequest"
            WHERE "startedFulfillingAt" IS NULL
            ORDER BY "createdAt"
            LIMIT ${pollerClaimLimit}
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *;
        `;
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
      // if (getNodeEnvironment().includes("development") || getNodeEnvironment().includes("test")) {
      //   const url = new URL(fullUrl);
      //   if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      //     url.hostname = "host.docker.internal";
      //     fullUrl = url.toString();
      //   }
      // }

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
      let processed = 0;

      if (directSyncEnabled()) {
        for (const request of requests) {
          try {
            await processRequest(request);
            processed++;
          } catch (error) {
            captureError("poller-iteration-error", error);
          }
        }
        return processed;
      }

      if (requests.length === 0) return 0;

      try {
        const batchPayload = requests.map(buildUpstashRequest);
        console.log("publishing to QStash batch", { count: batchPayload.length });
        await upstash.batchJSON(batchPayload);
        await deleteOutgoingRequests(requests.map((request) => request.id));
        return requests.length;
      } catch (error) {
        captureError("poller-iteration-error", error);
        return 0;
      }
    }

    while (performance.now() - startTime < maxDurationMs) {
      console.log("poller-iteration", performance.now() - startTime);
      const pendingRequests = await claimPendingRequests();

      if (stopWhenIdle && pendingRequests.length === 0) {
        break;
      }

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
