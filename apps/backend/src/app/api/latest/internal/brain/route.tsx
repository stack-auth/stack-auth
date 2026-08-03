import {
  countPendingBrainQueueItems,
  ensureBrainRow,
  isBrainEnabled,
  listBrainMessages,
} from "@/lib/brain";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  adminAuthTypeSchema,
  yupMixed,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get Brain state and recent messages",
    description: "Returns the singleton Brain conversation for the current tenancy/environment.",
    tags: ["Brain"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
      cursor: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  async handler({ auth, query }) {
    if (!isBrainEnabled(auth.tenancy)) {
      throw new StatusError(StatusError.Forbidden, "Brain is not enabled for this project. Install the Brain app to use it.");
    }

    await ensureBrainRow(globalPrismaClient, auth.tenancy.id);

    const limit = query.limit != null ? Number(query.limit) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      throw new StatusError(StatusError.BadRequest, "Invalid limit");
    }

    let cursor: { position: number, id: string } | null = null;
    if (query.cursor != null && query.cursor.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(query.cursor);
      } catch {
        throw new StatusError(StatusError.BadRequest, "Invalid cursor");
      }
      if (
        parsed == null
        || typeof parsed !== "object"
        || typeof (parsed as { position?: unknown }).position !== "number"
        || typeof (parsed as { id?: unknown }).id !== "string"
      ) {
        throw new StatusError(StatusError.BadRequest, "Invalid cursor");
      }
      cursor = {
        position: (parsed as { position: number }).position,
        id: (parsed as { id: string }).id,
      };
    }

    const [brain, pendingQueueCount, messagePage] = await Promise.all([
      globalPrismaClient.brain.findUnique({
        where: { tenancyId: auth.tenancy.id },
        select: { runState: true },
      }),
      countPendingBrainQueueItems(auth.tenancy.id),
      listBrainMessages({
        tenancyId: auth.tenancy.id,
        visibleOnly: true,
        limit,
        cursor,
        direction: "backward",
      }),
    ]);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        enabled: true,
        pending_queue_count: pendingQueueCount,
        run_state: brain?.runState ?? "NONE",
        messages: messagePage.messages.map((message) => ({
          id: message.id,
          position: message.position,
          role: message.role,
          content: message.content,
          visibility: message.visibility,
          created_at: message.createdAt.toISOString(),
        })),
        next_cursor: messagePage.nextCursor == null ? null : {
          position: messagePage.nextCursor.position,
          id: messagePage.nextCursor.id,
        },
      },
    };
  },
});
