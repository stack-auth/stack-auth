import { getPrismaClientForTenancy, getPrismaSchemaForTenancy, sqlQuoteIdent } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

type ReplayRow = {
  id: string,
  projectUserId: string,
  startedAt: Date,
  lastEventAt: Date,
  projectUserDisplayName: string | null,
  primaryEmail: string | null,
};

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

    const rows = await prisma.$queryRaw<ReplayRow[]>`
      SELECT
        sr."id",
        sr."projectUserId",
        sr."startedAt",
        sr."lastEventAt",
        pu."displayName" AS "projectUserDisplayName",
        (
          SELECT cc."value"
          FROM ${sqlQuoteIdent(schema)}."ContactChannel" cc
          WHERE cc."projectUserId" = sr."projectUserId"
            AND cc."tenancyId" = sr."tenancyId"
            AND cc."type" = 'EMAIL'
            AND cc."isPrimary" = 'TRUE'::"BooleanTrue"
          LIMIT 1
        ) AS "primaryEmail"
      FROM ${sqlQuoteIdent(schema)}."SessionReplay" sr
      JOIN ${sqlQuoteIdent(schema)}."ProjectUser" pu
        ON pu."projectUserId" = sr."projectUserId"
        AND pu."tenancyId" = sr."tenancyId"
      WHERE sr."tenancyId" = ${auth.tenancy.id}::UUID
        AND sr."id" = ${sessionReplayId}
      LIMIT 1
    `;

    const row = rows.at(0);
    if (row == null) {
      throw new KnownErrors.ItemNotFound(sessionReplayId);
    }

    const chunkAgg = (await prisma.sessionReplayChunk.groupBy({
      by: ["sessionReplayId"],
      where: {
        tenancyId: auth.tenancy.id,
        sessionReplayId,
      },
      _count: { _all: true },
      _sum: { eventCount: true },
    })).at(0);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        id: row.id,
        project_user: {
          id: row.projectUserId,
          display_name: row.projectUserDisplayName ?? null,
          primary_email: row.primaryEmail ?? null,
        },
        started_at_millis: row.startedAt.getTime(),
        last_event_at_millis: row.lastEventAt.getTime(),
        chunk_count: chunkAgg == null ? 0 : chunkAgg._count._all,
        event_count: chunkAgg == null ? 0 : (chunkAgg._sum.eventCount ?? 0),
      },
    };
  },
});
