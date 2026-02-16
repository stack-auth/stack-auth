import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupArray, yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BODY_BYTES = 5_000_000;
const MAX_EVENTS = 5_000;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Upload analytics event batch",
    description: "Uploads a batch of auto-captured web events (page views, clicks, etc.).",
    tags: ["Analytics"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
      user: adaptSchema,
    }).defined(),
    body: yupObject({
      browser_session_id: yupString().defined().matches(UUID_RE, "Invalid browser_session_id"),
      tab_id: yupString().defined().matches(UUID_RE, "Invalid tab_id"),
      batch_id: yupString().defined().matches(UUID_RE, "Invalid batch_id"),
      sent_at_ms: yupNumber().defined().integer().min(0),
      events: yupArray(yupObject({
        event_type: yupString().defined(),
        event_at_ms: yupNumber().defined().integer().min(0),
        data: yupMixed().defined(),
      }).defined()).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      status: yupString().oneOf(["ok"]).defined(),
      event_count: yupNumber().defined(),
    }).defined(),
  }),
  async handler({ auth, body }, fullReq) {
    if (!auth.tenancy.config.apps.installed["analytics"]?.enabled) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { status: "ok", event_count: 0 },
      };
    }
    if (!auth.user) {
      throw new KnownErrors.UserAuthenticationRequired();
    }

    if (fullReq.bodyBuffer.byteLength > MAX_BODY_BYTES) {
      throw new StatusError(StatusError.PayloadTooLarge, `Request body too large (max ${MAX_BODY_BYTES} bytes)`);
    }

    if (body.events.length === 0) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { status: "ok", event_count: 0 },
      };
    }
    if (body.events.length > MAX_EVENTS) {
      throw new StatusError(StatusError.BadRequest, `Too many events (max ${MAX_EVENTS})`);
    }

    const projectId = auth.tenancy.project.id;
    const branchId = auth.tenancy.branchId;
    const userId = auth.user.id;
    const browserSessionId = body.browser_session_id;
    const tabId = body.tab_id;

    const rows = body.events.map((event) => ({
      event_type: event.event_type,
      event_at: new Date(event.event_at_ms),
      data: {
        ...(typeof event.data === "object" ? event.data as Record<string, unknown> : {}),
        browser_session_id: browserSessionId,
        tab_id: tabId,
      },
      project_id: projectId,
      branch_id: branchId,
      user_id: userId,
      team_id: null,
    }));

    const clickhouseClient = getClickhouseAdminClient();
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
      body: { status: "ok", event_count: body.events.length },
    };
  },
});
