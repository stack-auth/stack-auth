import { PrismaClient } from "@/generated/prisma/client";
import { downloadBytes } from "@/s3";
import { PrismaClientWithReplica } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";

const gunzip = promisify(gunzipCb);

export type LoadedSessionReplayChunk = {
  id: string,
  batchId: string,
  sessionReplaySegmentId: string | null,
  browserSessionId: string | null,
  eventCount: number,
  byteLength: number,
  firstEventAt: Date,
  lastEventAt: Date,
  createdAt: Date,
  events: unknown[],
};

export async function loadSessionReplayChunks(
  prisma: PrismaClientWithReplica<PrismaClient>,
  options: {
    tenancyId: string,
    sessionReplayId: string,
    offset?: number,
    limit?: number,
  },
): Promise<LoadedSessionReplayChunk[]> {
  const exists = await prisma.sessionReplay.findUnique({
    where: { tenancyId_id: { tenancyId: options.tenancyId, id: options.sessionReplayId } },
    select: { id: true },
  });
  if (!exists) {
    throw new KnownErrors.ItemNotFound(options.sessionReplayId);
  }

  const chunks = await prisma.sessionReplayChunk.findMany({
    where: {
      tenancyId: options.tenancyId,
      sessionReplayId: options.sessionReplayId,
    },
    orderBy: [{ firstEventAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      batchId: true,
      sessionReplaySegmentId: true,
      browserSessionId: true,
      eventCount: true,
      byteLength: true,
      firstEventAt: true,
      lastEventAt: true,
      createdAt: true,
      s3Key: true,
    },
  });

  const offset = options.offset ?? 0;
  const limit = options.limit ?? chunks.length;
  const selectedChunks = chunks.slice(offset, Math.min(offset + limit, chunks.length));

  return await Promise.all(selectedChunks.map(async (chunk) => {
    let bytes: Uint8Array;
    try {
      bytes = await downloadBytes({ key: chunk.s3Key, private: true });
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404) {
        throw new KnownErrors.ItemNotFound(chunk.id);
      }
      throw error;
    }

    const unzipped = new Uint8Array(await gunzip(bytes));
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(unzipped));
    } catch (error) {
      throw new StackAssertionError("Failed to decode session replay chunk JSON", { cause: error });
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new StackAssertionError("Decoded session replay chunk is not an object");
    }
    if ((parsed as { session_replay_id?: unknown }).session_replay_id !== options.sessionReplayId) {
      throw new StackAssertionError("Decoded session replay chunk session_replay_id mismatch", {
        expected: options.sessionReplayId,
        actual: (parsed as { session_replay_id?: unknown }).session_replay_id,
      });
    }
    if (!Array.isArray((parsed as { events?: unknown }).events)) {
      throw new StackAssertionError("Decoded session replay chunk events is not an array");
    }

    return {
      id: chunk.id,
      batchId: chunk.batchId,
      sessionReplaySegmentId: chunk.sessionReplaySegmentId,
      browserSessionId: chunk.browserSessionId,
      eventCount: chunk.eventCount,
      byteLength: chunk.byteLength,
      firstEventAt: chunk.firstEventAt,
      lastEventAt: chunk.lastEventAt,
      createdAt: chunk.createdAt,
      events: (parsed as { events: unknown[] }).events,
    };
  }));
}
