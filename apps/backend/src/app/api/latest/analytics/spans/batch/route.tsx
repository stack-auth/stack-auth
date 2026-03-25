import { isValidPublicAnalyticsSpanType, UUID_RE } from "@/lib/analytics-validation";
import { insertSpans } from "@/lib/spans";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const MAX_SPANS = 200;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload analytics span batch",
    description: "Uploads a batch of span records (timed operations) for analytics.",
    tags: ["Analytics Spans"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
      refreshTokenId: adaptSchema,
    }).defined(),
    body: yupObject({
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      sent_at_ms: yupNumber().defined().integer().min(0),
      spans: yupArray(
        yupObject({
          span_type: yupString().defined().test(
            "analytics-span-type",
            'span_type must not start with "$" and may only contain letters, numbers, ".", "_", ":", or "-"',
            (value) => isValidPublicAnalyticsSpanType(value),
          ),
          span_id: yupString().defined().matches(UUID_RE, "Invalid span_id"),
          trace_id: yupString().optional().matches(UUID_RE, "Invalid trace_id"),
          started_at_ms: yupNumber().defined().integer().min(0),
          ended_at_ms: yupNumber().optional().nullable().integer().min(0),
          parent_ids: yupArray(yupString().defined().matches(UUID_RE, "Invalid parent_id")).optional().max(20),
          data: yupObject({}).defined().unknown(true),
          user_id: yupString().uuid().optional(),
          team_id: yupString().uuid().optional(),
          session_replay_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_id"),
          session_replay_segment_id: yupString().optional().matches(UUID_RE, "Invalid session_replay_segment_id"),
        }).defined(),
      ).defined().min(1).max(MAX_SPANS),
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

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;
    const defaultUserId = auth.user?.id ?? null;

    if (auth.type === "client" && body.spans.some((span) => span.user_id != null || span.team_id != null)) {
      throw new StatusError(StatusError.BadRequest, "Client analytics spans cannot override user_id or team_id");
    }

    const rows = body.spans.map((span) => ({
      span_type: span.span_type,
      span_id: span.span_id,
      trace_id: span.trace_id ?? null,
      started_at: new Date(span.started_at_ms),
      ended_at: span.ended_at_ms != null ? new Date(span.ended_at_ms) : null,
      parent_ids: span.parent_ids ?? [],
      data: span.data,
      project_id: projectId,
      branch_id: branchId,
      user_id: auth.type === "client" ? defaultUserId : (span.user_id ?? defaultUserId),
      team_id: auth.type === "client" ? null : (span.team_id ?? null),
      refresh_token_id: auth.refreshTokenId ?? null,
      session_replay_id: span.session_replay_id ?? null,
      session_replay_segment_id: span.session_replay_segment_id ?? null,
      from_server: auth.type !== "client",
    }));

    await insertSpans(rows);

    return {
      statusCode: 200,
      bodyType: "json",
      body: { inserted: body.spans.length },
    };
  },
});
