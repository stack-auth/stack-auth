import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_EVENTS = 500;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload analytics event batch",
    description: "Uploads a batch of auto-captured analytics events ($page-view, $click).",
    tags: ["Analytics Events"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
      refreshTokenId: adaptSchema,
    }).defined(),
    body: yupObject({
      session_replay_segment_id: yupString().defined().matches(UUID_RE, "Invalid session_replay_segment_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      sent_at_ms: yupNumber().defined().integer().min(0),
      events: yupArray(
        yupObject({
          event_type: yupString().defined().oneOf(["$page-view", "$click"]),
          event_at_ms: yupNumber().defined().integer().min(0),
          data: yupMixed().defined(),
        }).defined(),
      ).defined().min(1).max(MAX_EVENTS),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      inserted: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { inserted: 0 },
      };
    }
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (!auth.refreshTokenId) {
      throw new StatusError(StatusError.BadRequest, "A refresh token is required for analytics events");
    }

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;
    const userId = auth.user.id;
    const refreshTokenId = auth.refreshTokenId;
    const tenancyId = auth.tenancy.id;

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const recentSession = await findRecentSessionReplay(prisma, { tenancyId, refreshTokenId });

    const clickhouseClient = getClickhouseAdminClient();

    const rows = body.events.map((event) => ({
      event_type: event.event_type,
      event_at: new Date(event.event_at_ms),
      data: event.data,
      project_id: projectId,
      branch_id: branchId,
      user_id: userId,
      team_id: null,
      refresh_token_id: refreshTokenId,
      session_replay_id: recentSession?.id ?? null,
      session_replay_segment_id: body.session_replay_segment_id,
    }));

    await clickhouseClient.insert({
      table: "analytics_internal.events",
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        async_insert: 1,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: body.events.length },
    };
  },
});
