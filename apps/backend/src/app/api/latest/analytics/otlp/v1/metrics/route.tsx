import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { createOtlpHttpResponse, decodeOtlpHttpRequest, getOtlpHttpEncoding, OtlpHttpError, scrubOtlpErrorMessage } from "@/lib/otlp/http";
import { OtlpProtobufError } from "@/lib/otlp/protobuf";
import { buildOtlpMetricRows, insertOtlpMetrics } from "@/lib/otlp/metric-writer";
import { normalizeOtlpJsonMetricsRequest, OtlpMetricsRequestError } from "@/lib/otlp/metrics";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const MAX_METRIC_DATA_POINTS_PER_REQUEST = 10_000;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Export OpenTelemetry metrics",
    description: "Accepts authenticated OTLP/HTTP JSON or protobuf ExportMetricsServiceRequest messages.",
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
        throw new StatusError(StatusError.BadRequest, "A refresh token is required for browser OTLP metrics");
      }
      userId = auth.user.id;
      refreshTokenId = auth.refreshTokenId;
    }

    let encoding: ReturnType<typeof getOtlpHttpEncoding>;
    let metricsRequest: ReturnType<typeof normalizeOtlpJsonMetricsRequest>;
    try {
      encoding = getOtlpHttpEncoding(fullRequest.headers);
      metricsRequest = normalizeOtlpJsonMetricsRequest(decodeOtlpHttpRequest("metrics", encoding, body));
    } catch (error) {
      if (error instanceof OtlpMetricsRequestError || error instanceof OtlpProtobufError || error instanceof OtlpHttpError) {
        const fallback = error instanceof OtlpProtobufError
          ? "Invalid OTLP protobuf request"
          : "Invalid OTLP metrics request";
        throw new StatusError(StatusError.BadRequest, scrubOtlpErrorMessage(error.message, fallback));
      }
      throw error;
    }

    const tenant = {
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      userId,
      refreshTokenId,
    };
    const rows = buildOtlpMetricRows(metricsRequest, tenant);
    if (rows.length > MAX_METRIC_DATA_POINTS_PER_REQUEST) {
      throw new StatusError(StatusError.PayloadTooLarge, `OTLP metrics request contains more than ${MAX_METRIC_DATA_POINTS_PER_REQUEST} data points`);
    }
    if (rows.length > 0) {
      await insertOtlpMetrics(getSharedClickhouseAdminClient(), metricsRequest, tenant);
    }
    return createOtlpHttpResponse("metrics", encoding);
  },
});
