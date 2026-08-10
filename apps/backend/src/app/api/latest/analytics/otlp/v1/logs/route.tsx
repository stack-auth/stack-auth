import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { evaluateErrorIngestPolicy, persistErrorIngestClientReportProjection } from "@/lib/error-ingest";
import { createOtlpLogProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";
import { buildOtlpIssueInputs, getOtlpIssueBatchId, getOtlpLogPolicyData, insertOtlpLogs } from "@/lib/otlp-log-writer";
import { materializeIssuesFromBatchSafely } from "@/lib/issues/issue-store";
import { createOtlpHttpResponse, decodeOtlpHttpRequest, getOtlpHttpEncoding, OtlpHttpError, scrubOtlpErrorMessage } from "@/lib/otlp-http";
import { getHexclaveOtlpLogContractError, normalizeOtlpJsonLogsRequest, type CanonicalOtlpLogRecord } from "@/lib/otlp-logs";
import { OtlpProtobufError } from "@/lib/otlp-protobuf";
import { OtlpJsonRequestError } from "@/lib/otlp-json";
import type { OtlpTenantContext } from "@/lib/otlp-trace-writer";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const MAX_LOG_RECORDS_PER_REQUEST = 10_000;

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Export OpenTelemetry logs",
    description: "Accepts authenticated OTLP/HTTP JSON or protobuf ExportLogsServiceRequest messages.",
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
    if (!auth.tenancy.config.apps.installed.observability?.enabled) throw new KnownErrors.ObservabilityNotEnabled();
    let userId: string | null = null;
    let refreshTokenId: string | null = null;
    if (auth.type === "client") {
      if (!auth.user) throw new KnownErrors.UserAuthenticationRequired();
      if (!auth.refreshTokenId) throw new StatusError(StatusError.BadRequest, "A refresh token is required for browser OTLP logs");
      userId = auth.user.id;
      refreshTokenId = auth.refreshTokenId;
    }

    let encoding: ReturnType<typeof getOtlpHttpEncoding>;
    let logRecords: CanonicalOtlpLogRecord[];
    try {
      encoding = getOtlpHttpEncoding(fullRequest.headers);
      logRecords = normalizeOtlpJsonLogsRequest(decodeOtlpHttpRequest("logs", encoding, body));
    } catch (error) {
      if (error instanceof OtlpJsonRequestError || error instanceof OtlpProtobufError || error instanceof OtlpHttpError) {
        const fallback = error instanceof OtlpProtobufError
          ? "Invalid OTLP protobuf request"
          : "Invalid OTLP logs request";
        throw new StatusError(StatusError.BadRequest, scrubOtlpErrorMessage(error.message, fallback));
      }
      throw error;
    }
    if (logRecords.length > MAX_LOG_RECORDS_PER_REQUEST) {
      throw new StatusError(StatusError.PayloadTooLarge, `OTLP logs request contains more than ${MAX_LOG_RECORDS_PER_REQUEST} log records`);
    }
    const contractAcceptedIndexes = new Set<number>();
    let firstContractError: string | null = null;
    const origin = auth.type === "client" ? "client" : "server";
    for (const [itemIndex, logRecord] of logRecords.entries()) {
      const contractError = getHexclaveOtlpLogContractError(logRecord, origin);
      if (contractError === null) {
        contractAcceptedIndexes.add(itemIndex);
      } else {
        firstContractError ??= contractError;
      }
    }
    const tenant: OtlpTenantContext = {
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      userId,
      refreshTokenId,
      groupingConfig: auth.tenancy.config.observability.errorGrouping,
    };
    const policyDecision = evaluateErrorIngestPolicy({
      config: auth.tenancy.config,
      scope: {
        tenancyId: auth.tenancy.id,
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
      },
      items: logRecords.flatMap((logRecord, itemIndex) => contractAcceptedIndexes.has(itemIndex)
        ? [{ itemId: `log:${itemIndex}`, itemType: "log" as const, data: getOtlpLogPolicyData(logRecord) }]
        : []),
      nowMs: new Date().getTime(),
    });
    const acceptedItemIds = new Set(policyDecision.acceptedItemIds);
    const acceptedIndexes = new Set<number>();
    const acceptedLogRecords: CanonicalOtlpLogRecord[] = [];
    for (const [itemIndex, logRecord] of logRecords.entries()) {
      const itemId = `log:${itemIndex}`;
      if (!acceptedItemIds.has(itemId)) continue;
      acceptedIndexes.add(itemIndex);
      const scrubbedData = policyDecision.scrubbedData.get(itemId);
      acceptedLogRecords.push(scrubbedData === undefined ? logRecord : { ...logRecord, policyScrubbedData: scrubbedData });
    }
    const protocolProjection = createOtlpLogProtocolProjection(logRecords, acceptedIndexes, tenant, policyDecision.outcomes);
    runAsynchronouslyAndWaitUntil(persistErrorIngestClientReportProjection(
      {
        tenancyId: auth.tenancy.id,
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
      },
      "otlp_logs",
      protocolProjection,
    ));
    if (acceptedLogRecords.length > 0) {
      await insertOtlpLogs(getSharedClickhouseAdminClient(), acceptedLogRecords, tenant);
    }
    const issueInputs = buildOtlpIssueInputs(acceptedLogRecords, tenant);
    if (issueInputs.length > 0) {
      runAsynchronouslyAndWaitUntil(materializeIssuesFromBatchSafely({
        tenancy: auth.tenancy,
        batchId: getOtlpIssueBatchId(acceptedLogRecords, tenant),
        inputs: issueInputs,
        receivedAt: new Date(),
      }));
    }
    const partialSuccess = protocolProjection.otlpPartialSuccess.logs;
    if (partialSuccess.rejectedItems === 0) return createOtlpHttpResponse("logs", encoding);

    const fallbackErrorMessage = partialSuccess.body.partialSuccess?.errorMessage ?? "Invalid OTLP log records";
    return createOtlpHttpResponse("logs", encoding, {
      rejectedItems: partialSuccess.rejectedItems,
      errorMessage: firstContractError === null
        ? fallbackErrorMessage
        : scrubOtlpErrorMessage(firstContractError, fallbackErrorMessage),
    });
  },
});
