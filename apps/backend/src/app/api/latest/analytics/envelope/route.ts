import { getSharedClickhouseAdminClient } from "@/lib/clickhouse";
import { createProductionErrorAttachmentService, encodeErrorAttachmentBytes } from "@/lib/attachments";
import {
  createErrorIngestItemOutcome,
  createErrorIngestProtocolProjection,
  evaluateErrorIngestPolicy,
  parseErrorIngestEnvelope,
  persistErrorIngestClientReportProjection,
  persistErrorIngestClientReportRequest,
  normalizeErrorIngestClientReportReportedAt,
  type ErrorIngestEnvelope,
  type ErrorIngestEnvelopeAttachmentPayload,
  type ErrorIngestEnvelopeItem,
  type ErrorIngestItemOutcome,
} from "@/lib/error-ingest";
import { projectSentryEnvelopeEvent } from "@/lib/error-ingest/error-ingest-event-adapter";
import { buildErrorIngestRateLimitHeaders } from "@/lib/error-ingest/error-ingest-rate-limits";
import { insertBatchEvents, normalizeBatchEvents } from "@/lib/analytics-telemetry-writers";
import { materializeIssuesFromBatchSafely } from "@/lib/issues/issue-store";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import type { TelemetryResource } from "@hexclave/shared/dist/utils/analytics-wire";
import { KnownErrors } from "@hexclave/shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { captureError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { globalPrismaClient } from "@/prisma-client";

function envelopeBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new StatusError(StatusError.BadRequest, "Sentry envelope body must be binary");
}

function envelopeResource(envelope: ErrorIngestEnvelope): TelemetryResource {
  const sdk = envelope.header.sdk;
  return {
    service: {
      name: sdk?.name ?? "sentry-envelope",
      ...(sdk?.version === undefined ? {} : { version: sdk.version }),
    },
    ...(envelope.header.trace?.environment === undefined ? {} : { deploymentEnvironmentName: envelope.header.trace.environment }),
  };
}

function protocolOutcomes(
  envelope: ErrorIngestEnvelope,
  policyOutcomes: ReadonlyMap<string, ErrorIngestItemOutcome>,
  attachmentOutcomes: ReadonlyMap<string, ErrorIngestItemOutcome>,
): readonly ErrorIngestItemOutcome[] {
  return envelope.items.map((item) => {
    if (item.wireType === "attachment" && item.outcome.status === "accepted") {
      const attachmentOutcome = attachmentOutcomes.get(item.itemId);
      if (attachmentOutcome === undefined) throw new Error("Sentry envelope attachment outcome is missing");
      return attachmentOutcome;
    }
    if (item.wireType === "event" && item.outcome.status === "accepted") {
      const policyOutcome = policyOutcomes.get(item.itemId);
      if (policyOutcome === undefined) throw new Error("Sentry envelope policy outcome is missing an event item");
      return item.outcome.eventId === undefined
        ? policyOutcome
        : { ...policyOutcome, eventId: item.outcome.eventId };
    }
    if (item.wireType === "transaction" && item.outcome.status === "accepted") {
      // Transactions parse and are reported honestly rather than silently
      // dropped, but nothing projects them onto spans yet. The span projection
      // arrives with the OpenTelemetry change; until then a client that sends
      // one gets an explicit "unsupported" outcome for that item alone, and the
      // rest of the envelope is still ingested.
      return createErrorIngestItemOutcome(
        { itemId: item.itemId, itemType: "transaction", ...(item.outcome.eventId === undefined ? {} : { eventId: item.outcome.eventId }) },
        { status: "rejected", reason: "unsupported" },
      );
    }
    return item.outcome;
  });
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Ingest a Sentry-compatible error envelope",
    description: "Accepts an authenticated, bounded Sentry envelope and projects error events onto issues.",
    tags: ["Analytics Events"],
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
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
    headers: yupMixed().defined(),
  }),
  handler: async ({ auth, body }) => {
    if (!auth.tenancy.config.apps.installed.observability?.enabled) throw new KnownErrors.ObservabilityNotEnabled();
    const bytes = envelopeBytes(body);
    const attachmentPayloads = new Map<string, ErrorIngestEnvelopeAttachmentPayload>();
    let envelope: ErrorIngestEnvelope;
    try {
      envelope = parseErrorIngestEnvelope(bytes, {
        onAttachment: (payload) => attachmentPayloads.set(payload.itemId, payload),
      });
    } catch (error) {
      if (error instanceof StatusError) throw error;
      if (error instanceof Error) throw new StatusError(StatusError.BadRequest, error.message);
      throw new StatusError(StatusError.BadRequest, "Invalid Sentry envelope");
    }

    let userId: string | null = null;
    let refreshTokenId: string | null = null;
    if (auth.type === "client") {
      if (!auth.user) throw new KnownErrors.UserAuthenticationRequired();
      if (!auth.refreshTokenId) throw new StatusError(StatusError.BadRequest, "A refresh token is required for browser Sentry envelopes");
      userId = auth.user.id;
      refreshTokenId = auth.refreshTokenId;
    }

    const receivedAtMs = new Date().getTime();
    const eventItems = envelope.items.flatMap((item) => {
      if (item.wireType !== "event" || item.event === undefined || item.outcome.status !== "accepted") return [];
      const projected = projectSentryEnvelopeEvent({ event: item.event, header: envelope.header, item, receivedAtMs });
      return [{ item, projected }];
    });
    const scope = {
      tenancyId: auth.tenancy.id,
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
    };
    const policy = evaluateErrorIngestPolicy({
      config: auth.tenancy.config,
      scope,
      items: eventItems.map(({ item, projected }) => ({
        itemId: item.itemId,
        itemType: "event" as const,
        data: projected.data,
      })),
      nowMs: receivedAtMs,
    });
    const policyByItemId = new Map(policy.outcomes.map((outcome) => [outcome.itemId, outcome]));
    const acceptedEvents = eventItems.flatMap(({ item, projected }) => {
      if (!policy.acceptedItemIds.includes(item.itemId)) return [];
      const scrubbedData = policy.scrubbedData.get(item.itemId);
      return [{ ...projected, data: scrubbedData ?? projected.data }];
    });

    const attachmentOutcomes = new Map<string, ErrorIngestItemOutcome>();
    if (attachmentPayloads.size > 0) {
      try {
        const attachmentService = await createProductionErrorAttachmentService(auth.tenancy);
        const attachmentScope = {
          tenantId: auth.tenancy.id,
          projectId: auth.tenancy.project.id,
          branchId: auth.tenancy.branchId,
        };
        for (const item of envelope.items) {
          if (item.wireType !== "attachment" || item.outcome.status !== "accepted") continue;
          const payload = attachmentPayloads.get(item.itemId);
          if (payload === undefined) throw new Error("Sentry envelope attachment payload is missing");
          try {
            await attachmentService.upload(attachmentScope, {
              eventId: payload.eventId,
              occurrenceId: null,
              idempotencyKey: `${envelope.batchId}:${payload.itemIndex}:${payload.sha256}`,
              filename: payload.filename,
              contentType: payload.contentType,
              attachmentType: payload.attachmentType,
              dataBase64: encodeErrorAttachmentBytes(payload.bytes),
            });
            attachmentOutcomes.set(item.itemId, createErrorIngestItemOutcome(
              { itemId: item.itemId, itemType: "attachment", eventId: payload.eventId },
              { status: "accepted" },
            ));
          } catch (error) {
            // Attachment storage is an independent Sentry envelope item. Keep a
            // valid event usable when private object storage is temporarily
            // unavailable, while recording the failure as an item outcome so the
            // client can retry and operators can see the loss reason.
            captureError("sentry-envelope-attachment-storage", error);
            attachmentOutcomes.set(item.itemId, createErrorIngestItemOutcome(
              { itemId: item.itemId, itemType: "attachment", eventId: payload.eventId },
              { status: "dropped", reason: "delivery_failed" },
            ));
          }
        }
      } catch (error) {
        captureError("sentry-envelope-attachment-service", error);
        for (const item of envelope.items) {
          if (item.wireType !== "attachment" || item.outcome.status !== "accepted") continue;
          const payload = attachmentPayloads.get(item.itemId);
          if (payload === undefined) throw new Error("Sentry envelope attachment payload is missing");
          attachmentOutcomes.set(item.itemId, createErrorIngestItemOutcome(
            { itemId: item.itemId, itemType: "attachment", eventId: payload.eventId },
            { status: "dropped", reason: "delivery_failed" },
          ));
        }
      }
    }

    if (acceptedEvents.length > 0) {
      const resource = envelopeResource(envelope);
      const normalized = normalizeBatchEvents(acceptedEvents, {
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
        userId,
        refreshTokenId,
        sessionReplayId: null,
        sessionReplaySegmentId: null,
        runtime: auth.type === "client" ? "browser" : "server",
        resource,
        producer: "sdk",
        groupingConfig: auth.tenancy.config.observability.errorGrouping,
      }, envelope.batchId);
      await insertBatchEvents(getSharedClickhouseAdminClient(), normalized, envelope.batchId);
      if (normalized.issueInputs.length > 0) {
        runAsynchronouslyAndWaitUntil(materializeIssuesFromBatchSafely({
          tenancy: auth.tenancy,
          batchId: envelope.batchId,
          inputs: normalized.issueInputs,
          receivedAt: new Date(receivedAtMs),
        }));
      }
    }

    const outcomes = protocolOutcomes(envelope, policyByItemId, attachmentOutcomes);
    const projection = createErrorIngestProtocolProjection(envelope.batchId, outcomes);
    runAsynchronouslyAndWaitUntil(persistErrorIngestClientReportProjection(scope, "sentry_envelope", projection));
    const envelopeSentAt = envelope.header.sentAt === null ? null : new Date(envelope.header.sentAt);
    const receivedAt = new Date(receivedAtMs);
    for (const item of envelope.items) {
      if (item.clientReport === undefined || item.outcome.status !== "accepted") continue;
      runAsynchronouslyAndWaitUntil(persistErrorIngestClientReportRequest(
        scope,
        item.clientReport,
        globalPrismaClient,
        normalizeErrorIngestClientReportReportedAt(item.clientReport, envelopeSentAt, receivedAt),
      ));
    }

    return {
      statusCode: 200,
      bodyType: "json",
      headers: buildErrorIngestRateLimitHeaders(projection.items),
      body: {
        batch_id: envelope.batchId,
        status: projection.status,
        inserted: acceptedEvents.length,
        ingest: {
          counts: { ...projection.counts },
          outcomes: [...projection.items],
          client_report: {
            discarded_events: [...projection.clientReport.discarded_events],
            rate_limited_events: [...projection.clientReport.rate_limited_events],
            filtered_events: [...projection.clientReport.filtered_events],
            filtered_sampling_events: [...projection.clientReport.filtered_sampling_events],
          },
          idempotency_key: projection.idempotencyKey,
        },
      },
    };
  },
});
