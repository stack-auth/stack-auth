import { getTools, type ToolExecutionRunner } from "@/lib/ai/tools";
import {
  globalPrismaClient,
  retryTransaction,
  type PrismaClientTransaction,
} from "@/prisma-client";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import {
  appendBrainToolTrace,
  finishBrainToolTrace,
} from "./messages";
import {
  acknowledgeBrainQueueItems,
  claimBrainQueueItems,
  listBrainQueueItems,
  requeueBrainQueueItemsByClaimLease,
  releaseBrainQueueItems,
} from "./queue";
import { sanitizeBrainPayload } from "./sanitize";

export type BrainToolContext = {
  tenancyId: string,
  projectId: string,
  runLeaseToken: string,
  claimedQueueItems: Map<string, string>,
  claimAttempted: boolean,
};

async function assertBrainToolLease(
  tx: PrismaClientTransaction,
  context: BrainToolContext,
): Promise<void> {
  const lease = await tx.brain.findFirst({
    where: {
      tenancyId: context.tenancyId,
      runState: "RUNNING",
      runLeaseToken: context.runLeaseToken,
    },
    select: { tenancyId: true },
  });
  if (lease == null) {
    throw new HexclaveAssertionError("Brain tool attempted a mutation after losing its lease", {
      tenancyId: context.tenancyId,
    });
  }
}

export function createBrainExecutionRunner(context: BrainToolContext): ToolExecutionRunner {
  return async function runTrackedTool<T>(options: {
    toolCallId: string,
    toolName: string,
    input: unknown,
    execute: () => Promise<T>,
  }): Promise<T> {
    const persisted = await appendBrainToolTrace({
      tenancyId: context.tenancyId,
      runLeaseToken: context.runLeaseToken,
      toolCallId: options.toolCallId,
      toolName: options.toolName,
      input: sanitizeBrainPayload(options.input),
    });
    const startedAt = performance.now();
    const execution = await Result.fromPromise(options.execute());
    const durationMs = Math.round(performance.now() - startedAt);
    await finishBrainToolTrace({
      tenancyId: context.tenancyId,
      runLeaseToken: context.runLeaseToken,
      messageId: persisted.messageId,
      trace: persisted.trace,
      durationMs,
      result: execution.status === "ok"
        ? { status: "completed", output: sanitizeBrainPayload(execution.data) }
        : { status: "failed" },
    });
    if (execution.status === "error") {
      throw execution.error;
    }
    return execution.data;
  };
}

/**
 * Server-side tools the Brain may call while processing its queue. These are
 * intentionally separate from the interactive AI tool registry — the Brain
 * never inherits client-selected tool permissions.
 */
export async function getBrainTools(context: BrainToolContext): Promise<ToolSet> {
  const executionRunner = createBrainExecutionRunner(context);
  const projectReadTools = await getTools(["sql-query", "read-config"], {
    auth: null,
    targetProjectId: context.projectId,
    executionRunner,
    resultSanitizer: sanitizeBrainPayload,
  });

  return {
    ...projectReadTools,
    listBrainQueueItems: tool({
      description: "List items currently on the Brain Queue (pending, claimed, or failed). Use this to decide what to process next.",
      inputSchema: z.object({
        statuses: z.array(z.enum(["QUEUED", "CLAIMED", "COMPLETED", "FAILED"])).optional()
          .describe("Filter by status. Defaults to QUEUED, CLAIMED, and FAILED."),
        limit: z.number().int().min(1).max(50).optional()
          .describe("Max items to return (default 20)."),
      }),
      execute: async (input, executionOptions) => {
        return await executionRunner({
          toolCallId: executionOptions.toolCallId,
          toolName: "listBrainQueueItems",
          input,
          execute: async () => {
            const result = await listBrainQueueItems({
              tenancyId: context.tenancyId,
              statuses: input.statuses,
              limit: input.limit ?? 20,
            });
            return {
              items: result.items.map((item) => ({
                id: item.id,
                type: item.type,
                schemaVersion: item.schemaVersion,
                payload: item.payload,
                occurredAt: item.occurredAt.toISOString(),
                subjectType: item.subjectType,
                subjectId: item.subjectId,
                status: item.status,
                attempts: item.attempts,
                lastError: item.lastError,
                availableAt: item.availableAt.toISOString(),
                createdAt: item.createdAt.toISOString(),
              })),
              nextCursor: result.nextCursor,
            };
          },
        });
      },
    }),

    claimBrainQueueItems: tool({
      description: "Claim (pop) Brain Queue items so you can process them. Prefer claiming specific IDs after listing. Claimed items are leased to you; acknowledge them when done or release them on failure.",
      inputSchema: z.object({
        ids: z.array(z.string().uuid()).optional()
          .describe("Specific queue item IDs to claim. If omitted, claims the oldest due items."),
        limit: z.number().int().min(1).max(50).optional()
          .describe("Max items to claim when ids are omitted (default 10)."),
      }),
      execute: async (input, executionOptions) => {
        const isFirstClaim = !context.claimAttempted;
        context.claimAttempted = true;
        return await executionRunner({
          toolCallId: executionOptions.toolCallId,
          toolName: "claimBrainQueueItems",
          input,
          execute: async () => {
            if (!isFirstClaim) {
              return { claimed: [] };
            }
            const claimed = await retryTransaction(globalPrismaClient, async (tx) => {
              await assertBrainToolLease(tx, context);
              return await claimBrainQueueItems(tx, {
                tenancyId: context.tenancyId,
                ids: input.ids,
                limit: input.limit ?? 10,
              });
            });
            for (const item of claimed) {
              context.claimedQueueItems.set(item.id, item.claimLeaseToken);
            }
            return {
              claimed: claimed.map((item) => ({
                id: item.id,
                type: item.type,
                schemaVersion: item.schemaVersion,
                payload: item.payload,
                occurredAt: item.occurredAt.toISOString(),
                subjectType: item.subjectType,
                subjectId: item.subjectId,
                attempts: item.attempts,
              })),
            };
          },
        });
      },
    }),

    acknowledgeBrainQueueItems: tool({
      description: "Mark claimed Brain Queue items as completed after you have processed them. Always acknowledge items you no longer need so the Brain can sleep when the queue is empty.",
      inputSchema: z.object({
        ids: z.array(z.string().uuid()).min(1)
          .describe("Claimed queue item IDs to mark completed."),
      }),
      execute: async (input, executionOptions) => {
        return await executionRunner({
          toolCallId: executionOptions.toolCallId,
          toolName: "acknowledgeBrainQueueItems",
          input,
          execute: async () => {
            const count = await retryTransaction(globalPrismaClient, async (tx) => {
              await assertBrainToolLease(tx, context);
              return await acknowledgeBrainQueueItems(tx, {
                tenancyId: context.tenancyId,
                ids: input.ids,
              });
            });
            if (count > 0) {
              for (const id of input.ids) {
                context.claimedQueueItems.delete(id);
              }
            }
            return { acknowledged: count };
          },
        });
      },
    }),

    releaseBrainQueueItems: tool({
      description: "Release claimed Brain Queue items back to the queue (with backoff) or mark them failed. Use when you cannot process an item now.",
      inputSchema: z.object({
        ids: z.array(z.string().uuid()).min(1),
        error: z.string().max(2000).optional()
          .describe("Short reason recorded on the item."),
        fail: z.boolean().optional()
          .describe("When true, mark FAILED instead of re-queuing."),
      }),
      execute: async (input, executionOptions) => {
        return await executionRunner({
          toolCallId: executionOptions.toolCallId,
          toolName: "releaseBrainQueueItems",
          input,
          execute: async () => {
            const count = await retryTransaction(globalPrismaClient, async (tx) => {
              await assertBrainToolLease(tx, context);
              return await releaseBrainQueueItems(tx, {
                tenancyId: context.tenancyId,
                ids: input.ids,
                error: input.error,
                fail: input.fail ?? false,
              });
            });
            if (count > 0) {
              for (const id of input.ids) {
                context.claimedQueueItems.delete(id);
              }
            }
            return { released: count };
          },
        });
      },
    }),
  };
}

/**
 * A model turn can stop after claiming an item without reaching its
 * acknowledge call (for example when it exhausts its step budget). Do not
 * leave that item claimed indefinitely; return it to the queue with a small
 * backoff so the next turn can retry it.
 */
export async function cleanupUnacknowledgedBrainClaims(
  context: BrainToolContext,
): Promise<number> {
  const claims = [...context.claimedQueueItems.entries()];
  if (claims.length === 0) return 0;

  const count = await retryTransaction(globalPrismaClient, async (tx) => {
    await assertBrainToolLease(tx, context);
    return await requeueBrainQueueItemsByClaimLease(tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens: claims.map(([, claimLeaseToken]) => claimLeaseToken),
      error: "Brain turn ended before acknowledging the claimed item",
    });
  });
  context.claimedQueueItems.clear();
  return count;
}
