import type { Prisma } from "@/generated/prisma/client";
import { PrismaClientTransaction, globalPrismaClient, retryTransaction } from "@/prisma-client";
import type { BrainMessageVisibility } from "@hexclave/shared/dist/interface/brain";
import { HexclaveAssertionError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { ensureBrainRow } from "./ensure";

export type BrainMessageContent = Prisma.InputJsonValue;

export type AppendBrainMessageInput = {
  role: "user" | "assistant" | "tool" | "system",
  content: unknown,
  visibility?: BrainMessageVisibility,
  queueItemId?: string | null,
  idempotencyKey?: string | null,
};

function toInputJsonValue(content: unknown): Prisma.InputJsonValue {
  // Round-trip through JSON so AI SDK tool-call objects become plain JSON
  // values Prisma accepts. JSON.parse's return type is `any`; narrowing it
  // to InputJsonValue is safe because the round-trip can only produce JSON.
  const parsed: unknown = JSON.parse(JSON.stringify(content ?? null));
  return parsed as Prisma.InputJsonValue;
}

export async function updateBrainMessageContent(options: {
  tenancyId: string,
  messageId: string,
  role: AppendBrainMessageInput["role"],
  content: unknown,
  runLeaseToken?: string,
  expectedToolStatus?: BrainToolTrace["status"],
}): Promise<boolean> {
  const result = await globalPrismaClient.brainMessage.updateMany({
    where: {
      tenancyId: options.tenancyId,
      id: options.messageId,
      role: options.role,
      ...(options.expectedToolStatus == null ? {} : {
        content: {
          path: ["status"],
          equals: options.expectedToolStatus,
        },
      }),
      ...(options.runLeaseToken == null ? {} : {
        brain: {
          runState: "RUNNING",
          runLeaseToken: options.runLeaseToken,
        },
      }),
    },
    data: {
      content: toInputJsonValue(options.content),
    },
  });
  return result.count === 1;
}

export type BrainToolTrace = {
  type: "tool-trace",
  toolCallId: string,
  toolName: string,
  status: "running" | "completed" | "failed" | "interrupted",
  input: unknown,
  output?: unknown,
  startedAt: string,
  completedAt?: string,
  durationMs?: number,
  error?: string,
};

export async function appendBrainToolTrace(options: {
  tenancyId: string,
  runLeaseToken: string,
  toolCallId: string,
  toolName: string,
  input: unknown,
}): Promise<{ messageId: string, trace: BrainToolTrace }> {
  const trace: BrainToolTrace = {
    type: "tool-trace",
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    status: "running",
    input: options.input,
    startedAt: new Date().toISOString(),
  };
  const appended = await retryTransaction(globalPrismaClient, async (tx) => {
    const lease = await tx.brain.findFirst({
      where: {
        tenancyId: options.tenancyId,
        runState: "RUNNING",
        runLeaseToken: options.runLeaseToken,
      },
      select: { tenancyId: true },
    });
    if (lease == null) {
      throw new HexclaveAssertionError("Brain lease lost before tool execution", {
        tenancyId: options.tenancyId,
        toolName: options.toolName,
      });
    }
    return await appendBrainMessages(tx, options.tenancyId, [{
      role: "tool",
      content: trace,
      visibility: "visible",
      idempotencyKey: `brain-tool:${options.runLeaseToken}:${options.toolCallId}`,
    }]);
  });
  const messageId = appended.ids[0] ?? throwErr(new HexclaveAssertionError(
    "Brain tool trace message missing after append",
    { tenancyId: options.tenancyId, toolName: options.toolName },
  ));
  return { messageId, trace };
}

export async function finishBrainToolTrace(options: {
  tenancyId: string,
  runLeaseToken: string,
  messageId: string,
  trace: BrainToolTrace,
  durationMs: number,
  result:
    | { status: "completed", output: unknown }
    | { status: "failed" },
}): Promise<void> {
  const completedAt = new Date().toISOString();
  const content: BrainToolTrace = options.result.status === "completed"
    ? {
      ...options.trace,
      status: "completed",
      output: options.result.output,
      completedAt,
      durationMs: options.durationMs,
    }
    : {
      ...options.trace,
      status: "failed",
      error: "Tool execution failed",
      completedAt,
      durationMs: options.durationMs,
    };
  const updated = await updateBrainMessageContent({
    tenancyId: options.tenancyId,
    messageId: options.messageId,
    role: "tool",
    content,
    runLeaseToken: options.runLeaseToken,
    expectedToolStatus: "running",
  });
  if (!updated) {
    throw new HexclaveAssertionError("Brain tool trace missing on completion", {
      tenancyId: options.tenancyId,
      messageId: options.messageId,
    });
  }
}

export async function interruptStaleBrainToolTraces(options: {
  tenancyId: string,
  currentRunLeaseToken: string,
}): Promise<number> {
  const running = await globalPrismaClient.brainMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      role: "tool",
      content: {
        path: ["status"],
        equals: "running",
      },
    },
    select: {
      id: true,
      content: true,
      idempotencyKey: true,
    },
  });
  const currentPrefix = `brain-tool:${options.currentRunLeaseToken}:`;
  const stale = running.filter((message) => message.idempotencyKey?.startsWith(currentPrefix) !== true);
  const interrupted = await Promise.all(stale.map(async (message) => {
    const content = message.content;
    if (content == null || typeof content !== "object" || Array.isArray(content)) {
      throw new HexclaveAssertionError("Running Brain tool trace has invalid content", {
        tenancyId: options.tenancyId,
        messageId: message.id,
      });
    }
    return await updateBrainMessageContent({
      tenancyId: options.tenancyId,
      messageId: message.id,
      role: "tool",
      content: {
        ...content,
        status: "interrupted",
        error: "Tool execution was interrupted",
        completedAt: new Date().toISOString(),
      },
      expectedToolStatus: "running",
    });
  }));
  return interrupted.filter((updated) => updated).length;
}

/**
 * Atomically allocates positions and appends messages. Uses the Brain row's
 * nextMessagePosition counter (never MAX(position)+1) so concurrent writers
 * cannot collide. Idempotency keys make crash-replayed appends no-ops.
 */
export async function appendBrainMessages(
  client: PrismaClientTransaction,
  tenancyId: string,
  messages: AppendBrainMessageInput[],
): Promise<{ ids: string[], positions: number[] }> {
  if (messages.length === 0) {
    return { ids: [], positions: [] };
  }

  await ensureBrainRow(client, tenancyId);

  // Lock the Brain row so position allocation and append stay atomic with
  // whatever lease/fencing the caller already established.
  const locked = await client.$queryRaw<Array<{ nextMessagePosition: number }>>`
    SELECT "nextMessagePosition"
    FROM "Brain"
    WHERE "tenancyId" = ${tenancyId}::uuid
    FOR UPDATE
  `;
  const brain = locked[0] ?? throwErr(new HexclaveAssertionError("Brain row missing after ensureBrainRow", { tenancyId }));
  let nextPosition = brain.nextMessagePosition;

  const rows: Array<{
    tenancyId: string,
    position: number,
    role: string,
    content: BrainMessageContent,
    visibility: string,
    queueItemId: string | null,
    idempotencyKey: string | null,
  }> = [];
  const positions: number[] = [];

  for (const message of messages) {
    const position = nextPosition;
    nextPosition += 1;
    positions.push(position);
    rows.push({
      tenancyId,
      position,
      role: message.role,
      content: toInputJsonValue(message.content),
      visibility: message.visibility ?? "visible",
      queueItemId: message.queueItemId ?? null,
      idempotencyKey: message.idempotencyKey ?? null,
    });
  }

  // createMany + skipDuplicates: if an idempotency key already exists, the
  // conflicting row is skipped. We still advance nextMessagePosition to the
  // allocated end so a partial skip doesn't reuse positions for later appends
  // that succeeded under a different key. Gaps from skipped duplicates are
  // acceptable; uniqueness of position is what matters.
  await client.brainMessage.createMany({
    data: rows,
    skipDuplicates: true,
  });

  await client.brain.update({
    where: { tenancyId },
    data: { nextMessagePosition: nextPosition },
  });

  const idempotencyKeys = rows
    .map((row) => row.idempotencyKey)
    .filter((key): key is string => key != null);
  const created = await client.brainMessage.findMany({
    where: {
      tenancyId,
      OR: [
        { position: { in: positions } },
        ...(idempotencyKeys.length > 0
          ? [{ idempotencyKey: { in: idempotencyKeys } }]
          : []),
      ],
    },
    select: { id: true, position: true, idempotencyKey: true },
  });
  const byPosition = new Map(created.map((row) => [row.position, row]));
  const byIdempotencyKey = new Map(created.flatMap((row) => (
    row.idempotencyKey == null ? [] : [[row.idempotencyKey, row] as const]
  )));
  const resolved = rows.map((row, index) => (
    row.idempotencyKey == null
      ? byPosition.get(positions[index])
      : byIdempotencyKey.get(row.idempotencyKey)
  ) ?? throwErr(new HexclaveAssertionError("Brain message missing after idempotent append", {
    tenancyId,
    position: positions[index],
  })));

  return {
    ids: resolved.map((row) => row.id),
    positions: resolved.map((row) => row.position),
  };
}

export type ListBrainMessagesOptions = {
  tenancyId: string,
  /** When true (default for UI), omit autonomous wake prompts. */
  visibleOnly?: boolean,
  limit?: number,
  /**
   * Keyset cursor in transcript order. Position is atomically allocated and
   * therefore remains correct when concurrent messages share timestamps.
   */
  cursor?: { position: number, id: string } | null,
  direction?: "backward" | "forward",
};

export async function listBrainMessages(options: ListBrainMessagesOptions) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const visibleOnly = options.visibleOnly ?? true;
  const direction = options.direction ?? "backward";

  // This powers the live internal Brain timeline. Replica lag would otherwise
  // hide tool start/completion transitions during the polling window.
  const rows = await globalPrismaClient.brainMessage.findMany({
    where: {
      tenancyId: options.tenancyId,
      ...(visibleOnly ? { visibility: "visible" } : {}),
      ...(options.cursor != null ? (
        direction === "backward"
          ? { position: { lt: options.cursor.position } }
          : { position: { gt: options.cursor.position } }
      ) : {}),
    },
    orderBy: direction === "backward"
      ? [{ position: "desc" }, { id: "desc" }]
      : [{ position: "asc" }, { id: "asc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // UI wants chronological order even when we fetched newest-first.
  const ordered = direction === "backward" ? [...page].reverse() : page;
  const nextCursor = hasMore && page.length > 0
    ? {
      position: page[page.length - 1].position,
      id: page[page.length - 1].id,
    }
    : null;

  return { messages: ordered, nextCursor };
}

/**
 * Loads the model context: rolling summary + recent messages (including hidden).
 */
export async function loadBrainModelContext(tenancyId: string, recentLimit = 40) {
  const brain = await globalPrismaClient.brain.findUnique({
    where: { tenancyId },
  });
  if (brain == null) {
    return { summaryText: null as string | null, messages: [] as Awaited<ReturnType<typeof globalPrismaClient.brainMessage.findMany>> };
  }

  const summaryThrough = brain.summaryThroughPosition ?? -1;
  const newestMessages = await globalPrismaClient.brainMessage.findMany({
    where: {
      tenancyId,
      position: { gt: summaryThrough },
      // Tool activity rows are a live UI execution trace. The model already
      // receives tool calls/results through the AI SDK within the active turn,
      // and replaying these UI-only rows would produce invalid tool messages.
      role: { not: "tool" },
    },
    orderBy: { position: "desc" },
    take: recentLimit,
  });

  return {
    summaryText: brain.summaryText,
    messages: newestMessages.reverse(),
  };
}
