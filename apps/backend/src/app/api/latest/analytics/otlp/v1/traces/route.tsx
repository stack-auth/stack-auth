import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { evaluateErrorIngestPolicy, persistErrorIngestClientReportProjection } from "@/lib/error-ingest";
import { createOtlpTraceProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";
import { createOtlpHttpResponse, decodeOtlpHttpRequest, getOtlpHttpEncoding, OtlpHttpError, scrubOtlpErrorMessage } from "@/lib/otlp-http";
import { OtlpProtobufError } from "@/lib/otlp-protobuf";
import { buildOtlpTraceRows, getOtlpSpanPolicyData, insertOtlpTraces, type OtlpTenantContext } from "@/lib/otlp-trace-writer";
import { normalizeOtlpJsonTraceRequest, OtlpTraceRequestError, type CanonicalOtlpSpan } from "@/lib/otlp-traces";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { tryDecreasePlanItemQuantities } from "@/lib/plan-metering";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { KnownErrors } from "@hexclave/shared";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const MAX_SPANS_PER_REQUEST = 10_000;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Export OpenTelemetry traces",
    description: "Accepts authenticated OTLP/HTTP JSON or protobuf ExportTraceServiceRequest messages.",
    tags: ["Observability"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema,
      refreshTokenId: adaptSchema,
    }).defined(),
    body: yupMixed().defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    body: yupMixed().defined(),
    headers: yupObject({
      "content-type": yupTuple([yupString().defined()]).defined(),
    }).defined(),
  }),
  handler: async ({ auth, body }, fullRequest) => {
    if (!auth.tenancy.config.apps.installed.observability?.enabled) {
      throw new KnownErrors.ObservabilityNotEnabled();
    }
    let userId: string | null = null;
    let refreshTokenId: string | null = null;
    if (auth.type === "client") {
      if (!auth.user) throw new KnownErrors.UserAuthenticationRequired();
      if (!auth.refreshTokenId) {
        throw new StatusError(StatusError.BadRequest, "A refresh token is required for browser OTLP traces");
      }
      userId = auth.user.id;
      refreshTokenId = auth.refreshTokenId;
    }

    let encoding: ReturnType<typeof getOtlpHttpEncoding>;
    let spans: CanonicalOtlpSpan[];
    try {
      encoding = getOtlpHttpEncoding(fullRequest.headers);
      spans = normalizeOtlpJsonTraceRequest(decodeOtlpHttpRequest("traces", encoding, body));
    } catch (error) {
      if (error instanceof OtlpTraceRequestError || error instanceof OtlpProtobufError || error instanceof OtlpHttpError) {
        const fallback = error instanceof OtlpProtobufError
          ? "Invalid OTLP protobuf request"
          : "Invalid OTLP traces request";
        throw new StatusError(StatusError.BadRequest, scrubOtlpErrorMessage(error.message, fallback));
      }
      throw error;
    }
    if (spans.length > MAX_SPANS_PER_REQUEST) {
      throw new StatusError(StatusError.PayloadTooLarge, `OTLP trace request contains more than ${MAX_SPANS_PER_REQUEST} spans`);
    }

    const tenant: OtlpTenantContext = {
      // These values always come from the authenticated key/session. OTLP
      // resources and baggage are deliberately unable to select a tenant or user.
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      userId,
      refreshTokenId,
    };
    const policyDecision = evaluateErrorIngestPolicy({
      config: auth.tenancy.config,
      scope: {
        tenancyId: auth.tenancy.id,
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
      },
      items: spans.map((span) => ({
        itemId: `span:${span.traceId}:${span.spanId}`,
        itemType: "span" as const,
        data: getOtlpSpanPolicyData(span),
      })),
      nowMs: new Date().getTime(),
    });
    const acceptedItemIds = new Set(policyDecision.acceptedItemIds);
    const acceptedSpans = spans.flatMap((span) => {
      const itemId = `span:${span.traceId}:${span.spanId}`;
      if (!acceptedItemIds.has(itemId)) return [];
      const scrubbedData = policyDecision.scrubbedData.get(itemId);
      return [scrubbedData === undefined ? span : { ...span, policyScrubbedData: scrubbedData }];
    });
    const rows = buildOtlpTraceRows(acceptedSpans, tenant);
    const billableSpansByIdentity = new Map(
      rows.spans
        .filter((span) => span.billing_item === "analytics_spans")
        .map((span) => [`${span.trace_id}:${span.span_id}`, span]),
    );
    const billableSpanCount = billableSpansByIdentity.size;
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    if (
      auth.tenancy.project.id !== "internal"
      && billingTeamId != null
      && billableSpanCount > 0
      && arePlanLimitsEnforced()
    ) {
      const debit = await tryDecreasePlanItemQuantities(
        billingTeamId,
        [...billableSpansByIdentity].map(([spanIdentity, span]) => ({
          itemId: ITEM_IDS.analyticsSpans,
          quantity: 1,
          idempotency: {
            key: `otlp-span:${spanIdentity}`,
            createdAt: span.ended_at ?? span.started_at,
          },
        })),
      );
      if (debit.insufficientItemId != null) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(
          debit.insufficientItemId,
          billingTeamId,
          billableSpanCount,
        );
      }
    }

    // Every custom span has a stable metering row keyed by authenticated tenant
    // plus W3C span identity. OTLP exporters may retry the same span in a new
    // batch after an ambiguous response; retaining that debit on a ClickHouse
    // error makes the retry idempotent. Refunding it here would let the retry's
    // identical debit collapse while the refund remained, producing free usage.
    if (acceptedSpans.length > 0) {
      await insertOtlpTraces(getSharedClickhouseAdminClient(), acceptedSpans, tenant);
    }

    const protocolProjection = createOtlpTraceProtocolProjection(spans, tenant, policyDecision.outcomes);
    runAsynchronouslyAndWaitUntil(persistErrorIngestClientReportProjection(
      {
        tenancyId: auth.tenancy.id,
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
      },
      "otlp_traces",
      protocolProjection,
    ));
    const partialSuccess = protocolProjection.otlpPartialSuccess.traces;
    if (partialSuccess.rejectedItems === 0) return createOtlpHttpResponse("traces", encoding);

    return createOtlpHttpResponse("traces", encoding, {
      rejectedItems: partialSuccess.rejectedItems,
      errorMessage: partialSuccess.body.partialSuccess?.errorMessage ?? "Invalid OTLP trace records",
    });
  },
});
