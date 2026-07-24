import { insertAnalyticsSpans } from "@/lib/analytics-spans";
import { normalizeOtlpJsonTraceRequest, OtlpValidationError, type NormalizedOtlpSpan } from "@/lib/otlp";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { getHexclaveServerApp } from "@/hexclave";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, StatusError } from "@hexclave/shared/dist/utils/errors";

const MAX_OTLP_JSON_BYTES = 8 * 1024 * 1024;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Export OpenTelemetry traces",
    description: "Accepts an OTLP/HTTP JSON ExportTraceServiceRequest and stores its spans in Analytics.",
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
    body: yupMixed().defined(),
    bodyBuffer: adaptSchema,
    headers: adaptSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({}).defined(),
  }),
  async handler({ auth, body, bodyBuffer, headers }) {
    if (!auth.tenancy.config.apps.installed.analytics?.enabled) {
      throw new KnownErrors.AnalyticsNotEnabled();
    }
    // Browser exporters authenticate as the current client session. Requiring a
    // real user prevents the publishable key by itself from becoming an
    // unauthenticated, billable telemetry write primitive.
    if (auth.type === "client" && auth.user == null) {
      throw new KnownErrors.UserAuthenticationRequired();
    }
    if (bodyBuffer.byteLength > MAX_OTLP_JSON_BYTES) {
      throw new StatusError(StatusError.BadRequest, "OTLP request body is too large");
    }

    const contentType = headers["content-type"]?.[0]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      throw new StatusError(StatusError.BadRequest, "OTLP trace export currently requires Content-Type: application/json");
    }

    let spans: NormalizedOtlpSpan[];
    try {
      // Normalization preserves OTLP TraceId and SpanId as separate protocol
      // fields; the ClickHouse primary key scopes span_id by trace_id.
      spans = normalizeOtlpJsonTraceRequest(body);
    } catch (error) {
      if (error instanceof OtlpValidationError) {
        throw new StatusError(StatusError.BadRequest, error.message);
      }
      throw error;
    }

    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    let wasDebited = false;
    if (billingTeamId !== null && spans.length > 0 && arePlanLimitsEnforced()) {
      const item = await getHexclaveServerApp().getItem({ itemId: ITEM_IDS.analyticsSpans, teamId: billingTeamId });
      wasDebited = await item.tryDecreaseQuantity(spans.length);
      if (!wasDebited) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.analyticsSpans, billingTeamId, spans.length);
      }
    }

    try {
      if (spans.length > 0) {
        await insertAnalyticsSpans({
          spans,
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
          userId: auth.user?.id ?? null,
          refreshTokenId: auth.refreshTokenId ?? null,
        });
      }
    } catch (error) {
      if (wasDebited && billingTeamId !== null) {
        try {
          const item = await getHexclaveServerApp().getItem({ itemId: ITEM_IDS.analyticsSpans, teamId: billingTeamId });
          await item.increaseQuantity(spans.length);
        } catch (refundError) {
          captureError("analytics-otlp-span-insert-refund", refundError);
        }
      }
      throw error;
    }

    // ExportTraceServiceResponse has no required fields. Returning an empty JSON
    // object is the canonical successful OTLP/HTTP JSON response.
    return {
      statusCode: 200,
      bodyType: "json",
      body: {},
    };
  },
});
