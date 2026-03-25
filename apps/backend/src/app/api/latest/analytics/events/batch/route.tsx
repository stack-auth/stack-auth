import { isValidPublicAnalyticsEventType, PUBLIC_STACK_ANALYTICS_EVENT_TYPE_LIST, UUID_RE } from "@/lib/analytics-validation";
import { insertAnalyticsEvents } from "@/lib/events";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { randomUUID } from "node:crypto";

const MAX_EVENTS = 500;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload analytics event batch",
    description: "Uploads a batch of Stack-managed browser analytics events or custom analytics events.",
    tags: ["Analytics Events"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
      refreshTokenId: adaptSchema,
    }).defined(),
    body: yupObject({
      session_replay_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_id"),
      session_replay_segment_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_segment_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      sent_at_ms: yupNumber().defined().integer().min(0),
      events: yupArray(
        yupObject({
          event_type: yupString().defined().test(
            "analytics-event-type",
            `event_type must be ${PUBLIC_STACK_ANALYTICS_EVENT_TYPE_LIST}, or a custom event name that does not start with "$" and only contains letters, numbers, ".", "_", ":", or "-"`,
            (value) => isValidPublicAnalyticsEventType(value),
          ),
          event_at_ms: yupNumber().defined().integer().min(0),
          data: yupObject({}).defined().unknown(true),
          user_id: yupString().uuid().optional(),
          team_id: yupString().uuid().optional(),
          event_id: yupString().optional().matches(UUID_RE, "Invalid event_id"),
          trace_id: yupString().optional().matches(UUID_RE, "Invalid trace_id"),
          parent_span_ids: yupArray(yupString().defined().matches(UUID_RE, "Invalid parent_span_id")).optional().max(20),
          session_replay_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_id"),
          session_replay_segment_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_segment_id"),
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
      throw new KnownErrors.AnalyticsNotEnabled();
    }

    if (auth.type === "client" && !auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (auth.type === "client" && !auth.refreshTokenId) {
      throw new StatusError(StatusError.BadRequest, "A refresh token is required for analytics events");
    }
    if (auth.type === "client" && body.events.some((event) => event.user_id != null || event.team_id != null)) {
      throw new StatusError(StatusError.BadRequest, "Client analytics events cannot override user_id or team_id");
    }

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;
    const clientUserId = auth.type === "client" ? auth.user?.id ?? null : null;
    if (auth.type === "client" && clientUserId === null) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    const defaultUserId = auth.user?.id ?? null;

    const explicitSessionReplayIds = [...new Set([
      body.session_replay_id,
      ...body.events.map((event) => event.session_replay_id),
    ].filter((sessionReplayId): sessionReplayId is string => sessionReplayId != null))];

    const needsFallbackSessionReplayId = body.session_replay_id == null || body.events.some((event) => event.session_replay_id == null);
    const shouldLoadPrisma = explicitSessionReplayIds.length > 0 || (auth.refreshTokenId != null && needsFallbackSessionReplayId);
    const prisma = shouldLoadPrisma ? await getPrismaClientForTenancy(auth.tenancy) : null;

    if (prisma && explicitSessionReplayIds.length > 0) {
      const explicitSessionReplays = await prisma.sessionReplay.findMany({
        where: {
          tenancyId: auth.tenancy.id,
          id: { in: explicitSessionReplayIds },
        },
        select: {
          id: true,
          refreshTokenId: true,
        },
      });

      const explicitSessionReplayIdsFound = new Set(explicitSessionReplays.map((sessionReplay) => sessionReplay.id));
      const missingSessionReplayId = explicitSessionReplayIds.find((sessionReplayId) => !explicitSessionReplayIdsFound.has(sessionReplayId));
      if (missingSessionReplayId != null) {
        throw new StatusError(StatusError.BadRequest, `Unknown session_replay_id: ${missingSessionReplayId}`);
      }

      if (auth.type === "client") {
        const invalidClientSessionReplay = explicitSessionReplays.find((sessionReplay) => sessionReplay.refreshTokenId !== auth.refreshTokenId);
        if (invalidClientSessionReplay != null) {
          throw new StatusError(StatusError.BadRequest, "Client analytics events can only reference the current session replay");
        }
      }
    }

    let recentSessionReplayId: string | null = null;
    if (prisma && auth.refreshTokenId && needsFallbackSessionReplayId) {
      const recentSession = await findRecentSessionReplay(prisma, {
        tenancyId: auth.tenancy.id,
        refreshTokenId: auth.refreshTokenId,
      });
      recentSessionReplayId = recentSession?.id ?? null;
    }

    const rows = body.events.map((event) => {
      const sessionReplayId = event.session_replay_id ?? body.session_replay_id ?? recentSessionReplayId;
      const sessionReplaySegmentId = event.session_replay_segment_id ?? body.session_replay_segment_id ?? null;
      const explicitParentSpanIds = event.parent_span_ids ?? [];
      // Auto-link events to their segment span (segment_id IS the span_id)
      const parentSpanIds = sessionReplaySegmentId && !explicitParentSpanIds.includes(sessionReplaySegmentId)
        ? [sessionReplaySegmentId, ...explicitParentSpanIds]
        : explicitParentSpanIds;

      return {
        event_type: event.event_type,
        event_id: event.event_id || randomUUID(),
        trace_id: event.trace_id ?? null,
        event_at: new Date(event.event_at_ms),
        parent_span_ids: parentSpanIds,
        data: event.data,
        project_id: projectId,
        branch_id: branchId,
        user_id: auth.type === "client" ? clientUserId : event.user_id ?? defaultUserId,
        team_id: auth.type === "client" ? null : event.team_id ?? null,
        refresh_token_id: auth.refreshTokenId ?? null,
        session_replay_id: sessionReplayId,
        session_replay_segment_id: sessionReplaySegmentId,
        from_server: auth.type !== "client",
      };
    });

    await insertAnalyticsEvents(rows);

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: body.events.length },
    };
  },
});
