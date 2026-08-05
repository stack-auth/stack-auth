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
  BRAIN_JAVASCRIPT_DEFAULT_BATCH_SIZE,
  BRAIN_JAVASCRIPT_MAX_BATCH_SIZE,
  BRAIN_JAVASCRIPT_MAX_BATCH_BYTES,
  BRAIN_JAVASCRIPT_MAX_CODE_BYTES,
  executeBrainJavascript,
  type BrainJavascriptOutcome,
} from "./javascript";
import {
  appendBrainToolTrace,
  finishBrainToolTrace,
  loadBrainAutomationMemory,
  saveBrainAutomationMemory,
} from "./messages";
import {
  acknowledgeBrainQueueItems,
  claimBrainQueueItems,
  countPendingBrainQueueItems,
  requeueBrainQueueItemsByClaimLease,
  releaseBrainQueueItems,
} from "./queue";
import { sanitizeBrainPayload } from "./sanitize";

export type BrainToolContext = {
  tenancyId: string,
  projectId: string,
  runLeaseToken: string,
  claimedQueueItems: Map<string, string>,
};

const brainJavascriptExecutionTails = new WeakMap<BrainToolContext, Promise<void>>();

function createBrainJavascriptExecutionLock(): {
  promise: Promise<void>,
  release: () => void,
} {
  let release: () => void = () => {
    throw new HexclaveAssertionError("Brain JavaScript execution lock was not initialized");
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function coalesceBrainJavascriptActions(
  actions: BrainJavascriptOutcome["actions"],
): BrainJavascriptOutcome["actions"] {
  const acknowledgedIds: string[] = [];
  const releaseGroups = new Map<string, {
    ids: string[],
    error: string | null,
    fail: boolean,
  }>();
  for (const action of actions) {
    if (action.type === "acknowledge") {
      acknowledgedIds.push(...action.ids);
      continue;
    }
    const key = JSON.stringify([action.fail, action.error]);
    const existing = releaseGroups.get(key);
    if (existing == null) {
      releaseGroups.set(key, {
        ids: [...action.ids],
        error: action.error,
        fail: action.fail,
      });
    } else {
      existing.ids.push(...action.ids);
    }
  }

  const result: BrainJavascriptOutcome["actions"] = [];
  if (acknowledgedIds.length > 0) {
    result.push({ type: "acknowledge", ids: acknowledgedIds });
  }
  for (const group of releaseGroups.values()) {
    result.push({ type: "release", ...group });
  }
  return result;
}

function sanitizeAutomationMemory(memory: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeBrainPayload(memory);
  if (sanitized == null || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    throw new HexclaveAssertionError("Brain automation memory sanitizer returned a non-object");
  }
  return Object.fromEntries(Object.entries(sanitized));
}

function getClaimReceipts(context: BrainToolContext, ids: string[]) {
  return ids.map((id) => {
    const claimLeaseToken = context.claimedQueueItems.get(id);
    if (claimLeaseToken == null) {
      throw new HexclaveAssertionError("Brain queue item is not owned by this tool invocation", {
        tenancyId: context.tenancyId,
        id,
      });
    }
    return { id, claimLeaseToken };
  });
}

async function assertBrainToolLease(
  tx: PrismaClientTransaction,
  context: BrainToolContext,
): Promise<void> {
  // Lock the Brain row for the rest of this transaction. A plain predicate
  // read would leave a race where the worker completes the run after the
  // check but before queue or memory mutations commit.
  const lease = await tx.$queryRaw<Array<{ tenancyId: string }>>`
    SELECT "tenancyId"
    FROM "Brain"
    WHERE "tenancyId" = ${context.tenancyId}::uuid
      AND "runState" = 'RUNNING'
      AND "runLeaseToken" = ${context.runLeaseToken}::uuid
    FOR UPDATE
  `;
  if (lease.length !== 1) {
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

async function requeueClaimedBatch(
  context: BrainToolContext,
  claimedIds: Set<string>,
  error: string,
): Promise<void> {
  const claimLeaseTokens = [...new Set([...claimedIds].flatMap((id) => {
    const token = context.claimedQueueItems.get(id);
    return token == null ? [] : [token];
  }))];
  await retryTransaction(globalPrismaClient, async (tx) => {
    await assertBrainToolLease(tx, context);
    await requeueBrainQueueItemsByClaimLease(tx, {
      tenancyId: context.tenancyId,
      claimLeaseTokens,
      error,
      retryDelayMs: 0,
    });
  });
  for (const id of claimedIds) {
    context.claimedQueueItems.delete(id);
  }
}

async function executeBrainQueueJavascriptUnserialized(
  context: BrainToolContext,
  input: { code: string, batchSize?: number },
) {
  const claimed = await retryTransaction(globalPrismaClient, async (tx) => {
    await assertBrainToolLease(tx, context);
    return await claimBrainQueueItems(tx, {
      tenancyId: context.tenancyId,
      limit: input.batchSize ?? BRAIN_JAVASCRIPT_DEFAULT_BATCH_SIZE,
    });
  });
  const allClaimedIds = new Set(claimed.map((item) => item.id));
  for (const item of claimed) {
    // Register ownership immediately after the claim transaction commits.
    // Every later operation can fail (payload partitioning, memory reads, or
    // the sandbox), and generateBrainTurn's final cleanup must be able to
    // recover the complete batch in each of those cases.
    context.claimedQueueItems.set(item.id, item.claimLeaseToken);
  }

  try {
    const candidates = claimed.map((item) => ({
      claimed: item,
      sandbox: {
        id: item.id,
        type: item.type,
        schemaVersion: item.schemaVersion,
        payload: item.payload,
        occurredAt: item.occurredAt.toISOString(),
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        attempts: item.attempts,
      },
    }));
    const selected: typeof candidates = [];
    const overflow: typeof candidates = [];
    let batchBytes = 2;
    for (const candidate of candidates) {
      const candidateBytes = Buffer.byteLength(JSON.stringify(candidate.sandbox), "utf8") + 1;
      if (selected.length === 0 || batchBytes + candidateBytes <= BRAIN_JAVASCRIPT_MAX_BATCH_BYTES) {
        selected.push(candidate);
        batchBytes += candidateBytes;
      } else {
        overflow.push(candidate);
      }
    }
    if (overflow.length > 0) {
      await retryTransaction(globalPrismaClient, async (tx) => {
        await assertBrainToolLease(tx, context);
        const released = await releaseBrainQueueItems(tx, {
          tenancyId: context.tenancyId,
          claims: overflow.map((candidate) => ({
            id: candidate.claimed.id,
            claimLeaseToken: candidate.claimed.claimLeaseToken,
          })),
          error: "Deferred because the Brain JavaScript batch reached its payload limit",
          retryDelayMs: 0,
          undoClaimAttempt: true,
        });
        if (released !== overflow.length) {
          throw new HexclaveAssertionError("Brain could not defer every oversized JavaScript batch item", {
            tenancyId: context.tenancyId,
            requested: overflow.length,
            released,
          });
        }
      });
      for (const candidate of overflow) {
        context.claimedQueueItems.delete(candidate.claimed.id);
        allClaimedIds.delete(candidate.claimed.id);
      }
    }
    const claimedIds = new Set(selected.map((candidate) => candidate.claimed.id));
    const memoryBefore = await loadBrainAutomationMemory(context.tenancyId);

    const outcome = await executeBrainJavascript({
      code: input.code,
      items: selected.map((candidate) => candidate.sandbox),
      memory: memoryBefore,
    });

    const actions = coalesceBrainJavascriptActions(outcome.actions);
    const finalizedIds = new Set<string>();
    for (const action of actions) {
      for (const id of action.ids) {
        if (!claimedIds.has(id)) {
          throw new HexclaveAssertionError("Brain JavaScript action escaped its claimed batch", {
            tenancyId: context.tenancyId,
            id,
          });
        }
        if (finalizedIds.has(id)) {
          throw new HexclaveAssertionError("Brain JavaScript finalized an item more than once", {
            tenancyId: context.tenancyId,
            id,
          });
        }
        finalizedIds.add(id);
      }
    }

    const sanitizedMemory = sanitizeAutomationMemory(outcome.memory);
    const memoryChanged = JSON.stringify(memoryBefore) !== JSON.stringify(sanitizedMemory);
    await retryTransaction(globalPrismaClient, async (tx) => {
      await assertBrainToolLease(tx, context);
      for (const action of actions) {
        if (action.type === "acknowledge") {
          const acknowledged = await acknowledgeBrainQueueItems(tx, {
            tenancyId: context.tenancyId,
            claims: getClaimReceipts(context, action.ids),
          });
          if (acknowledged !== action.ids.length) {
            throw new HexclaveAssertionError("Brain JavaScript could not acknowledge every claimed item", {
              tenancyId: context.tenancyId,
              requested: action.ids.length,
              acknowledged,
            });
          }
        } else {
          const released = await releaseBrainQueueItems(tx, {
            tenancyId: context.tenancyId,
            claims: getClaimReceipts(context, action.ids),
            error: action.error,
            fail: action.fail,
            retryDelayMs: 30_000,
          });
          if (released !== action.ids.length) {
            throw new HexclaveAssertionError("Brain JavaScript could not release every claimed item", {
              tenancyId: context.tenancyId,
              requested: action.ids.length,
              released,
            });
          }
        }
      }
      if (memoryChanged) {
        await saveBrainAutomationMemory(tx, {
          tenancyId: context.tenancyId,
          runLeaseToken: context.runLeaseToken,
          memory: sanitizedMemory,
        });
      }
      // Any item the script did not explicitly finalize is returned immediately
      // instead of being stranded until the model turn ends.
      await requeueBrainQueueItemsByClaimLease(tx, {
        tenancyId: context.tenancyId,
        claimLeaseTokens: [...new Set(selected.map((candidate) => candidate.claimed.claimLeaseToken))],
        error: "Brain JavaScript left the item untouched",
        retryDelayMs: 0,
        undoClaimAttempt: true,
      });
    });
    for (const id of claimedIds) {
      context.claimedQueueItems.delete(id);
      allClaimedIds.delete(id);
    }

    return {
      result: sanitizeBrainPayload(outcome.result),
      stats: {
        supplied: selected.length,
        acknowledged: actions
          .filter((action) => action.type === "acknowledge")
          .reduce((sum, action) => sum + action.ids.length, 0),
        released: actions
          .filter((action) => action.type === "release" && !action.fail)
          .reduce((sum, action) => sum + action.ids.length, 0),
        failed: actions
          .filter((action) => action.type === "release" && action.fail)
          .reduce((sum, action) => sum + action.ids.length, 0),
        untouched: selected.length - finalizedIds.size,
      },
      memoryUpdated: memoryChanged,
      remainingQueueItems: await countPendingBrainQueueItems(context.tenancyId),
    };
  } catch (error) {
    await requeueClaimedBatch(
      context,
      allClaimedIds,
      "Brain JavaScript failed before finalizing the batch",
    );
    throw error;
  }
}

export async function executeBrainQueueJavascript(
  context: BrainToolContext,
  input: { code: string, batchSize?: number },
) {
  // AI SDK tool calls in the same step may execute concurrently. Serialize the
  // complete read-modify-write cycle so each call sees automation memory saved
  // by the previous one instead of silently overwriting it.
  const previous = brainJavascriptExecutionTails.get(context) ?? Promise.resolve();
  const { promise: current, release } = createBrainJavascriptExecutionLock();
  brainJavascriptExecutionTails.set(context, current);
  await previous;
  try {
    return await executeBrainQueueJavascriptUnserialized(context, input);
  } finally {
    release();
    if (brainJavascriptExecutionTails.get(context) === current) {
      brainJavascriptExecutionTails.delete(context);
    }
  }
}

/**
 * Server-side tools the Brain may call while processing its queue. Queue
 * operations are deliberately presented as one JavaScript workspace: the
 * model can start manually and evolve durable batch-processing playbooks.
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
    executeBrainJavascript: tool({
      description: `Run JavaScript in an isolated sandbox with one automatically claimed Brain Queue batch. The snippet receives a \`brain\` object with synchronous functions:
- \`brain.fetch({ limit?, types? })\` returns queue items from this batch
- \`brain.acknowledge(ids)\` completes processed items
- \`brain.release(ids, { error? })\` retries items later using server-managed backoff
- \`brain.fail(ids, error)\` marks unrecoverable items failed
- \`brain.recall(key?)\`, \`brain.remember(key, value)\`, and \`brain.forget(key)\` maintain durable automation memory
- \`brain.stats()\` reports progress for this batch

Start with small, explicit code that examines items one by one. As recurring patterns become clear or the queue grows, save reusable playbooks or script ideas in memory and process larger batches. Return a concise JSON-serializable summary from the snippet. Every fetched item must be acknowledged, released, or failed; untouched items are safely requeued automatically.

Do not make external network calls or copy raw queue payloads into the result. The JavaScript workspace is only for transforming its supplied batch and producing a queue-action journal.`,
      inputSchema: z.object({
        code: z.string().min(1).max(BRAIN_JAVASCRIPT_MAX_CODE_BYTES)
          .describe("JavaScript function body. The variable `brain` is available; use `return` to return a JSON-serializable summary."),
        batchSize: z.number().int().min(1).max(BRAIN_JAVASCRIPT_MAX_BATCH_SIZE).optional()
          .describe(`Number of oldest due queue items made available to the snippet (default ${BRAIN_JAVASCRIPT_DEFAULT_BATCH_SIZE}, max ${BRAIN_JAVASCRIPT_MAX_BATCH_SIZE}).`),
      }),
      execute: async (input, executionOptions) => {
        return await executionRunner({
          toolCallId: executionOptions.toolCallId,
          toolName: "executeBrainJavascript",
          input,
          execute: async () => await executeBrainQueueJavascript(context, input),
        });
      },
    }),
  };
}

/**
 * Last-resort cleanup when generation exits while a sandbox call still owns
 * claims. Normal successful JavaScript calls finalize or immediately requeue
 * their complete batch.
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
