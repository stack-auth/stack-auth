import { getTenancy, type Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, retryTransaction, type PrismaClientTransaction } from "@/prisma-client";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { captureError, HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";
import type { ModelMessage } from "ai";
import { ensureBrainRow } from "./ensure";
import { isBrainEnabled } from "./events";
import { generateBrainTurn, getRequestedBrainToolForTurn } from "./generate";
import {
  appendBrainMessages,
  interruptStaleBrainToolTraces,
  loadBrainModelContext,
} from "./messages";
import { buildAutonomousWakePrompt } from "./prompt";
import {
  countPendingBrainQueueItems,
  requeueAllClaimedBrainQueueItems,
} from "./queue";

// Keep a full minute of fencing headroom beyond the turn timeout so a worker
// is not reclaimable while its timeout/cleanup path is still completing.
const BRAIN_RUN_LEASE_MS = 4 * 60 * 1000;
const BRAIN_TURN_TIMEOUT_MS = 180_000;
const BRAIN_REQUEUE_DELAY_MS = 15_000;
const BRAIN_MODEL_RECENT_MESSAGES = 40;

type ClaimedBrain = {
  tenancyId: string,
  runLeaseToken: string,
  projectId: string,
};

/**
 * Claims up to `limit` Brains that are due for work (wakeAt <= now, idle or
 * expired lease), with FOR UPDATE SKIP LOCKED so overlapping cron ticks are safe.
 */
async function claimDueBrains(limit: number): Promise<ClaimedBrain[]> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + BRAIN_RUN_LEASE_MS);
  const leaseToken = generateUuid();

  const rows = await globalPrismaClient.$queryRaw<Array<{
    tenancyId: string,
    runLeaseToken: string | null,
    projectId: string | null,
  }>>`
    UPDATE "Brain" AS b
    SET
      "runState" = 'RUNNING',
      "runLeaseUntil" = ${leaseUntil},
      "runLeaseToken" = ${leaseToken}::uuid,
      "runWakeAt" = NULL,
      "updatedAt" = ${now}
    WHERE b."tenancyId" IN (
      SELECT c."tenancyId"
      FROM "Brain" AS c
      WHERE (
        (
          c."runState" = 'IDLE'
          AND c."runWakeAt" IS NOT NULL
          AND c."runWakeAt" <= ${now}
        )
        OR (
          c."runState" = 'RUNNING'
          AND c."runLeaseUntil" IS NOT NULL
          AND c."runLeaseUntil" < ${now}
        )
      )
      ORDER BY COALESCE(c."runWakeAt", c."runLeaseUntil") ASC
      LIMIT ${limit}
      FOR UPDATE OF c SKIP LOCKED
    )
    RETURNING b."tenancyId", b."runLeaseToken", (
      SELECT t2."projectId" FROM "Tenancy" AS t2 WHERE t2."id" = b."tenancyId"
    ) AS "projectId"
  `;

  return rows.map((row) => ({
    tenancyId: row.tenancyId,
    runLeaseToken: row.runLeaseToken ?? throwErr(new HexclaveAssertionError("Claimed Brain missing lease token", { tenancyId: row.tenancyId })),
    projectId: row.projectId ?? throwErr(new HexclaveAssertionError("Claimed Brain missing projectId", { tenancyId: row.tenancyId })),
  }));
}

async function completeBrainRun(options: {
  tenancyId: string,
  runLeaseToken: string,
  wakeAt: Date | null,
}): Promise<boolean> {
  // Prefer the caller's wakeAt when set. Otherwise keep any wakeAt that was
  // scheduled concurrently (e.g. a human message posted while this turn was
  // still RUNNING) — a blind NULL write would drop that wake forever.
  const rows = await globalPrismaClient.$queryRaw<Array<{ tenancyId: string }>>`
    UPDATE "Brain"
    SET
      "runState" = 'IDLE',
      "runLeaseUntil" = NULL,
      "runLeaseToken" = NULL,
      "runWakeAt" = CASE
        WHEN ${options.wakeAt}::timestamptz IS NOT NULL THEN ${options.wakeAt}::timestamptz
        ELSE "runWakeAt"
      END,
      "updatedAt" = ${new Date()}
    WHERE "tenancyId" = ${options.tenancyId}::uuid
      AND "runLeaseToken" = ${options.runLeaseToken}::uuid
      AND "runState" = 'RUNNING'
    RETURNING "tenancyId"
  `;
  return rows.length === 1;
}

async function assertLeaseHeldInTx(
  tx: PrismaClientTransaction,
  tenancyId: string,
  runLeaseToken: string,
): Promise<void> {
  const fenced = await tx.brain.findFirst({
    where: {
      tenancyId,
      runLeaseToken,
      runState: "RUNNING",
    },
    select: { tenancyId: true },
  });
  if (fenced == null) {
    throw new HexclaveAssertionError("Brain lease lost inside transaction", { tenancyId });
  }
}

function brainMessagesToModelMessages(
  messages: Array<{ role: string, content: unknown }>,
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const message of messages) {
    // role=tool rows are dashboard execution traces, not AI SDK tool-result
    // messages. The SDK receives real tool results during the active turn.
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "system") {
      continue;
    }
    const content = normalizeContentForModel(message.content);
    if (content == null) continue;
    out.push({
      role: message.role,
      content,
    } as ModelMessage);
  }
  return out;
}

function normalizeContentForModel(content: unknown): string | Array<{ type: "text", text: string }> | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((part): part is { type: string, text?: string } => part != null && typeof part === "object")
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => ({ type: "text" as const, text: part.text as string }));
    // Older turns embedded tool-call archives in assistant rows. Feeding those
    // JSON blobs back makes the model reuse stale tool outputs instead of
    // calling tools again — and they are not valid assistant text.
    if (texts.length === 0) {
      return null;
    }
    return texts;
  }
  if (content != null && typeof content === "object" && "text" in content && typeof (content as { text: unknown }).text === "string") {
    return (content as { text: string }).text;
  }
  return content == null ? null : JSON.stringify(content);
}

/**
 * True when the latest visible message is a user message with no later
 * assistant reply — i.e. a human is waiting for a response.
 */
async function hasUnansweredHumanMessage(tenancyId: string): Promise<boolean> {
  const latestVisible = await globalPrismaClient.brainMessage.findFirst({
    where: { tenancyId, visibility: "visible" },
    orderBy: { position: "desc" },
    select: { role: true },
  });
  return latestVisible?.role === "user";
}

async function runBrainTurn(claimed: ClaimedBrain, tenancy: Tenancy): Promise<{
  shouldRewake: boolean,
  /** Human replies should rewake immediately; queue drains can back off. */
  wakeDelayMs: number,
}> {
  const pendingCount = await countPendingBrainQueueItems(claimed.tenancyId);
  const needsHumanReply = await hasUnansweredHumanMessage(claimed.tenancyId);

  if (pendingCount === 0 && !needsHumanReply) {
    return { shouldRewake: false, wakeDelayMs: 0 };
  }

  // Queue-driven wake: inject a hidden prompt the UI never shows. Human
  // messages are already on the transcript, so we skip the hidden prompt
  // when the queue is empty and only a human reply is owed.
  if (pendingCount > 0) {
    await retryTransaction(globalPrismaClient, async (tx) => {
      await assertLeaseHeldInTx(tx, claimed.tenancyId, claimed.runLeaseToken);
      await appendBrainMessages(tx, claimed.tenancyId, [{
        role: "user",
        content: [{ type: "text", text: buildAutonomousWakePrompt(pendingCount) }],
        visibility: "hidden",
        idempotencyKey: `wake:${claimed.runLeaseToken}`,
      }]);
    });
  }

  const latestHumanAtTurnStart = await globalPrismaClient.brainMessage.findFirst({
    where: {
      tenancyId: claimed.tenancyId,
      role: "user",
      visibility: "visible",
    },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const latestHumanPositionAtTurnStart = latestHumanAtTurnStart?.position ?? -1;
  const { summaryText, messages } = await loadBrainModelContext(
    claimed.tenancyId,
    BRAIN_MODEL_RECENT_MESSAGES,
  );
  const latestHumanPositionIncluded = messages.reduce((latest, message) => (
    message.role === "user" && message.visibility === "visible"
      ? Math.max(latest, message.position)
      : latest
  ), latestHumanPositionAtTurnStart);
  const modelMessages = brainMessagesToModelMessages(messages);
  if (modelMessages.length === 0) {
    return {
      shouldRewake: pendingCount > 0 || needsHumanReply,
      wakeDelayMs: needsHumanReply ? 0 : BRAIN_REQUEUE_DELAY_MS,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRAIN_TURN_TIMEOUT_MS);
  let generation: Awaited<ReturnType<typeof generateBrainTurn>>;
  try {
    // A hidden queue wake is appended after any pending human message. Select
    // forced tools from the visible transcript when a reply is owed so the
    // later wake cannot replace an explicit analytics/config request. A
    // queue-only turn deterministically starts with the JavaScript workspace.
    const requestedTool = getRequestedBrainToolForTurn({
      messages: modelMessages,
      visibleMessages: brainMessagesToModelMessages(
        messages.filter((message) => message.visibility === "visible"),
      ),
      needsHumanReply,
      pendingCount,
    });
    generation = await generateBrainTurn({
      tenancyId: claimed.tenancyId,
      projectId: tenancy.project.id,
      runLeaseToken: claimed.runLeaseToken,
      messages: modelMessages,
      summaryText,
      abortSignal: controller.signal,
      requestedTool,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  await retryTransaction(globalPrismaClient, async (tx) => {
    await assertLeaseHeldInTx(tx, claimed.tenancyId, claimed.runLeaseToken);
    await appendBrainMessages(tx, claimed.tenancyId, [{
      role: "assistant",
      content: generation.content.length > 0
        ? generation.content
        : [{ type: "text", text: generation.text || "(no response)" }],
      visibility: "visible",
      idempotencyKey: `assistant:${claimed.runLeaseToken}`,
    }]);
  });

  const remaining = await countPendingBrainQueueItems(claimed.tenancyId);
  // A concurrent human message can be followed by this turn's assistant row,
  // so checking only the latest role would incorrectly consider it answered.
  const newerHumanMessage = await globalPrismaClient.brainMessage.findFirst({
    where: {
      tenancyId: claimed.tenancyId,
      role: "user",
      visibility: "visible",
      position: { gt: latestHumanPositionIncluded },
    },
    select: { id: true },
  });
  return {
    shouldRewake: remaining > 0 || newerHumanMessage != null,
    wakeDelayMs: newerHumanMessage != null ? 0 : BRAIN_REQUEUE_DELAY_MS,
  };
}

/**
 * Process one Brain engine step: claim due Brains and run one autonomous turn
 * each. Safe under overlapping cron invocations.
 */
export async function runBrainEngineStep(options: {
  deadlineMs: number,
  batchSize?: number,
}): Promise<{ didWork: boolean }> {
  const batchSize = options.batchSize ?? 3;
  if (Date.now() >= options.deadlineMs) {
    return { didWork: false };
  }

  const claimed = await claimDueBrains(batchSize);
  if (claimed.length === 0) {
    return { didWork: false };
  }

  const tenancyCache = new Map<string, Tenancy | null>();

  await Promise.all(claimed.map(async (brain) => {
    try {
      await interruptStaleBrainToolTraces({
        tenancyId: brain.tenancyId,
        currentRunLeaseToken: brain.runLeaseToken,
      });
      // If this Brain was reclaimed after an expired run lease, the previous
      // turn may have died after claiming queue items. The new lease owns the
      // recovery path, so return those stale claims before generating.
      await retryTransaction(globalPrismaClient, async (tx) => {
        await assertLeaseHeldInTx(tx, brain.tenancyId, brain.runLeaseToken);
        await requeueAllClaimedBrainQueueItems(tx, {
          tenancyId: brain.tenancyId,
          error: "Previous Brain turn expired before acknowledging the item",
        });
      });
      let tenancy = tenancyCache.get(brain.tenancyId);
      if (tenancy === undefined) {
        tenancy = await getTenancy(brain.tenancyId);
        tenancyCache.set(brain.tenancyId, tenancy);
      }
      if (tenancy == null || !isBrainEnabled(tenancy)) {
        await completeBrainRun({
          tenancyId: brain.tenancyId,
          runLeaseToken: brain.runLeaseToken,
          wakeAt: null,
        });
        return;
      }

      const { shouldRewake, wakeDelayMs } = await runBrainTurn(brain, tenancy);
      const wakeAt = shouldRewake
        ? new Date(Date.now() + wakeDelayMs)
        : null;
      const completed = await completeBrainRun({
        tenancyId: brain.tenancyId,
        runLeaseToken: brain.runLeaseToken,
        wakeAt,
      });
      if (!completed) {
        captureError("brain-lease-fenced-on-complete", new HexclaveAssertionError(
          "Brain run completed after lease was stolen",
          { tenancyId: brain.tenancyId },
        ));
        return;
      }

      // A concurrent human post may have left an immediate wakeAt that we
      // preserved; keep draining in-process instead of waiting for cron.
      if (wakeAt != null && wakeAt.getTime() <= Date.now()) {
        runAsynchronouslyAndWaitUntil(runBrainEngineStep({
          deadlineMs: Date.now() + 60_000,
          batchSize: 1,
        }));
      } else {
        const due = await globalPrismaClient.brain.findFirst({
          where: {
            tenancyId: brain.tenancyId,
            runState: "IDLE",
            runWakeAt: { lte: new Date() },
          },
          select: { tenancyId: true },
        });
        if (due != null) {
          runAsynchronouslyAndWaitUntil(runBrainEngineStep({
            deadlineMs: Date.now() + 60_000,
            batchSize: 1,
          }));
        }
      }
    } catch (error) {
      captureError("brain-engine-turn-failed", error);
      await completeBrainRun({
        tenancyId: brain.tenancyId,
        runLeaseToken: brain.runLeaseToken,
        wakeAt: new Date(Date.now() + BRAIN_REQUEUE_DELAY_MS),
      });
    }
  }));

  return { didWork: true };
}

/**
 * Append a human message and schedule an immediate Brain turn. Serialized via
 * the same lease path as autonomous queue processing.
 */
export async function postHumanBrainMessage(options: {
  tenancy: Tenancy,
  text: string,
}): Promise<{ messageId: string }> {
  if (!isBrainEnabled(options.tenancy)) {
    throw new HexclaveAssertionError("Brain is not enabled for this tenancy", {
      tenancyId: options.tenancy.id,
    });
  }

  const tenancyId = options.tenancy.id;
  const { ids } = await retryTransaction(globalPrismaClient, async (tx) => {
    await ensureBrainRow(tx, tenancyId);
    const appended = await appendBrainMessages(tx, tenancyId, [{
      role: "user",
      content: [{ type: "text", text: options.text }],
      visibility: "visible",
    }]);
    await tx.brain.update({
      where: { tenancyId },
      data: { runWakeAt: new Date() },
    });
    return appended;
  });

  const messageId = ids[0] ?? throwErr(new HexclaveAssertionError("Human Brain message missing after append", { tenancyId }));

  // Kick the worker in the background (same pattern as the email queue). Cron
  // remains the durable driver if this process dies before the turn finishes.
  runAsynchronouslyAndWaitUntil(runBrainEngineStep({
    deadlineMs: Date.now() + 60_000,
    batchSize: 1,
  }));

  return { messageId };
}
