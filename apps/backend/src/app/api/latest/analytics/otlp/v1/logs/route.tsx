import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { evaluateErrorIngestPolicy, persistErrorIngestClientReportProjection } from "@/lib/error-ingest";
import { createOtlpLogProtocolProjection } from "@/lib/error-ingest/error-ingest-protocol-projections";
import { buildOtlpIssueInputs, getOtlpIssueBatchId, getOtlpLogBillingDebits, getOtlpLogPolicyData, insertOtlpLogs } from "@/lib/otlp/log-writer";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import { tryDecreasePlanItemQuantities } from "@/lib/plan-metering";
import { ITEM_IDS } from "@hexclave/shared/dist/plans";
import { findRecentSessionReplay } from "@/lib/session-replays";
import { buildTelemetryMaterializationMessage, enqueueQstashMessage } from "@/lib/qstash-outbox";
import { createOtlpHttpResponse, decodeOtlpHttpRequest, getOtlpHttpEncoding, OtlpHttpError, scrubOtlpErrorMessage } from "@/lib/otlp/http";
import { getHexclaveOtlpLogContractError, normalizeOtlpJsonLogsRequest, type CanonicalOtlpLogRecord } from "@/lib/otlp/logs";
import { OtlpProtobufError } from "@/lib/otlp/protobuf";
import { OtlpJsonRequestError } from "@/lib/otlp/json";
import type { OtlpTenantContext } from "@/lib/otlp/trace-writer";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { getPrismaClientForTenancy } from "@/prisma-client";

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
    const sessionReplayId = refreshTokenId === null
      ? null
      : (await findRecentSessionReplay(
        await getPrismaClientForTenancy(auth.tenancy),
        {
          tenancyId: auth.tenancy.id,
          refreshTokenId,
          ...userId === null ? {} : { projectUserId: userId },
        },
      ))?.id ?? null;
    const tenant: OtlpTenantContext = {
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
      userId,
      refreshTokenId,
      sessionReplayId,
      groupingConfig: auth.tenancy.config.observability.errorGrouping,
    };
    const policyDecision = evaluateErrorIngestPolicy({
      config: auth.tenancy.config,
      items: logRecords.flatMap((logRecord, itemIndex) => contractAcceptedIndexes.has(itemIndex)
        ? [{ itemId: `log:${itemIndex}`, itemType: "log" as const, data: getOtlpLogPolicyData(logRecord) }]
        : []),
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
    // Accepted OTLP log records are billable `analytics_events` occurrences,
    // exactly like the same records arriving via the legacy events/batch
    // route — this route must not be a quota bypass. The debit happens before
    // the ClickHouse insert (fail-closed), and each occurrence has a stable
    // idempotent metering row: OTLP exporters retry after ambiguous responses,
    // and an identical retry (same content → same occurrence ids) must collapse
    // onto the same debit. As on the traces route, a ClickHouse failure does
    // NOT refund — the retry's identical debit collapsing while a refund
    // remained would produce free usage.
    const billingDebits = getOtlpLogBillingDebits(acceptedLogRecords, tenant);
    const billingTeamId = getBillingTeamId(auth.tenancy.project);
    if (
      auth.tenancy.project.id !== "internal"
      && billingTeamId != null
      && billingDebits.length > 0
      && arePlanLimitsEnforced()
    ) {
      const debit = await tryDecreasePlanItemQuantities(
        billingTeamId,
        billingDebits.map((billingDebit) => ({
          itemId: ITEM_IDS.analyticsEvents,
          quantity: 1,
          idempotency: {
            key: `otlp-log:${auth.tenancy.id}:${billingDebit.occurrenceId}`,
            createdAt: billingDebit.eventAt,
          },
        })),
      );
      if (debit.insufficientItemId != null) {
        throw new KnownErrors.ItemQuantityInsufficientAmount(
          debit.insufficientItemId,
          billingTeamId,
          billingDebits.length,
        );
      }
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
    const issueInputs = buildOtlpIssueInputs(acceptedLogRecords, tenant);
    const issueBatchId = issueInputs.length === 0 ? null : getOtlpIssueBatchId(acceptedLogRecords, tenant);
    if (issueBatchId !== null) {
      await enqueueQstashMessage(buildTelemetryMaterializationMessage({
        tenancyId: auth.tenancy.id,
        batchId: issueBatchId,
      }));
    }
    if (acceptedLogRecords.length > 0) {
      await insertOtlpLogs(getSharedClickhouseAdminClient(), acceptedLogRecords, tenant);
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
