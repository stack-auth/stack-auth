import { Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy, getPrismaSchemaForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import {
  aggregateSessionReplayChunksByReplayIds,
  querySessionReplayAdminRows,
  sessionReplayAdminRowToApiItem,
} from "../session-replay-admin-rows";

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      session_replay_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      id: yupString().defined(),
      project_user: yupObject({
        id: yupString().defined(),
        display_name: yupString().nullable().defined(),
        primary_email: yupString().nullable().defined(),
      }).defined(),
      started_at_millis: yupNumber().defined(),
      last_event_at_millis: yupNumber().defined(),
      chunk_count: yupNumber().defined(),
      event_count: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, params }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const schema = await getPrismaSchemaForTenancy(auth.tenancy);
    const sessionReplayId = params.session_replay_id;

    const rows = await querySessionReplayAdminRows({
      prisma,
      schema,
      tenancyId: auth.tenancy.id,
      suffixSql: Prisma.sql`AND sr."id" = ${sessionReplayId} LIMIT 1`,
    });

    const row = rows.at(0);
    if (row == null) {
      throw new KnownErrors.ItemNotFound(sessionReplayId);
    }

    const aggById = await aggregateSessionReplayChunksByReplayIds(prisma, auth.tenancy.id, [sessionReplayId]);
    const agg = aggById.get(sessionReplayId) ?? { chunkCount: 0, eventCount: 0 };

    return {
      statusCode: 200,
      bodyType: "json",
      body: sessionReplayAdminRowToApiItem(row, agg),
    };
  },
});
