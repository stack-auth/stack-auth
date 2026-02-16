import { getPrismaClientForTenancy } from "@/prisma-client";
import { downloadBytes } from "@/s3";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { promisify } from "node:util";
import { gunzip as gunzipCb } from "node:zlib";

const gunzip = promisify(gunzipCb);

const S3_CONCURRENCY = 10;

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      session_recording_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      offset: yupString().optional(),
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      chunks: yupArray(yupObject({
        id: yupString().defined(),
        batch_id: yupString().defined(),
        tab_id: yupString().nullable().defined(),
        event_count: yupNumber().defined(),
        byte_length: yupNumber().defined(),
        first_event_at_millis: yupNumber().defined(),
        last_event_at_millis: yupNumber().defined(),
        created_at_millis: yupNumber().defined(),
      }).defined()).defined(),
      chunk_events: yupArray(yupObject({
        chunk_id: yupString().defined(),
        events: yupArray(yupMixed().defined()).defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  async handler({ auth, params, query }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    const sessionRecordingId = params.session_recording_id;
    const exists = await prisma.sessionRecording.findUnique({
      where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: sessionRecordingId } },
      select: { id: true },
    });
    if (!exists) {
      throw new KnownErrors.ItemNotFound(sessionRecordingId);
    }

    const chunks = await prisma.sessionRecordingChunk.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        sessionRecordingId,
      },
      orderBy: [{ firstEventAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        batchId: true,
        tabId: true,
        eventCount: true,
        byteLength: true,
        firstEventAt: true,
        lastEventAt: true,
        createdAt: true,
        s3Key: true,
      },
    });

    // Determine the slice of chunks to download events for.
    const parsedOffset = query.offset != null ? Number.parseInt(query.offset, 10) : 0;
    const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
    const parsedLimit = query.limit != null ? Number.parseInt(query.limit, 10) : chunks.length;
    const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? parsedLimit : chunks.length;
    const sliceEnd = Math.min(offset + limit, chunks.length);
    const chunksToDownload = chunks.slice(offset, sliceEnd);

    // Download and decompress S3 objects only for the requested range.
    const chunkEvents: Array<{ chunk_id: string, events: any[] }> = new Array(chunksToDownload.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < chunksToDownload.length) {
        const idx = nextIndex++;
        const chunk = chunksToDownload[idx];

        let bytes: Uint8Array;
        try {
          bytes = await downloadBytes({ key: chunk.s3Key, private: true });
        } catch (e: any) {
          const status = e?.$metadata?.httpStatusCode;
          if (status === 404) {
            throw new KnownErrors.ItemNotFound(chunk.id);
          }
          throw e;
        }
        const unzipped = new Uint8Array(await gunzip(bytes));

        let parsed: any;
        try {
          parsed = JSON.parse(new TextDecoder().decode(unzipped));
        } catch (e) {
          throw new StackAssertionError("Failed to decode session recording chunk JSON", { cause: e });
        }

        if (typeof parsed !== "object" || parsed === null) {
          throw new StackAssertionError("Decoded session recording chunk is not an object");
        }
        if (parsed.session_recording_id !== sessionRecordingId) {
          throw new StackAssertionError("Decoded session recording chunk session_recording_id mismatch", {
            expected: sessionRecordingId,
            actual: parsed.session_recording_id,
          });
        }
        if (!Array.isArray(parsed.events)) {
          throw new StackAssertionError("Decoded session recording chunk events is not an array");
        }

        chunkEvents[idx] = { chunk_id: chunk.id, events: parsed.events as any[] };
      }
    }

    const workers = Array.from(
      { length: Math.min(S3_CONCURRENCY, chunksToDownload.length) },
      () => worker(),
    );
    await Promise.all(workers);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        chunks: chunks.map((c) => ({
          id: c.id,
          batch_id: c.batchId,
          tab_id: c.tabId,
          event_count: c.eventCount,
          byte_length: c.byteLength,
          first_event_at_millis: c.firstEventAt.getTime(),
          last_event_at_millis: c.lastEventAt.getTime(),
          created_at_millis: c.createdAt.getTime(),
        })),
        chunk_events: chunkEvents,
      },
    };
  },
});
