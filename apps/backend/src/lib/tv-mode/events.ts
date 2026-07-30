import { type Tenancy } from "@/lib/tenancies";
import {
  evaluateTvEmailDelivery,
  evaluateTvUserMilestone,
  TV_EVENT_EVALUATION_INTERVAL_MS,
  type TvEmailEvaluationSample,
  type TvEmailEvaluatorState,
} from "@/lib/tv-mode/event-evaluators";
import {
  deriveTvPresentation,
  TV_RECOVERY_CONFIRMATION_MS,
  type TvDurableEventOccurrence,
  type TvDurablePresentationAssignment,
} from "@/lib/tv-mode/event-orchestration";
import {
  getPrismaClientForTenancy,
  getPrismaSchemaForTenancy,
  retryTransaction,
  sqlQuoteIdent,
} from "@/prisma-client";
import {
  type TvEvent,
  type TvInterruptionPreferences,
  type TvPresentedEventHighlight,
  type TvPresentedTakeover,
  type TvProfileResource,
} from "@hexclave/shared/dist/interface/admin-tv-mode";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { generateUuid } from "@hexclave/shared/dist/utils/uuids";

const MINUTE_MS = 60_000;
const MAX_EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

type EvaluatorClaimRow = {
  breachCount: number,
  criticalBreachCount: number,
  recoveryCount: number,
  milestoneBaseline: bigint | null,
  typedState: unknown,
  activeOccurrenceId: string | null,
  activePresentationClass: "CELEBRATION" | "INCIDENT" | "CRITICAL_INCIDENT" | null,
};

type OccurrenceRow = {
  id: string,
  eventType: "EMAIL_DELIVERY_DEGRADATION" | "USER_MILESTONE",
  presentationClass: "CELEBRATION" | "INCIDENT" | "CRITICAL_INCIDENT",
  lifecycle: "OCCURRED" | "ACTIVE" | "RESOLVED",
  title: string,
  summary: string,
  metricLabel: string,
  metricValue: string,
  expectedRange: string | null,
  sourceLabel: string,
  occurredAt: Date,
  activatedAt: Date | null,
  escalatedAt: Date | null,
  resolvedAt: Date | null,
  updatedAt: Date,
};

type AssignmentRow = {
  occurrenceId: string,
  takeoverStartedAt: Date | null,
  takeoverEndsAt: Date | null,
  highlightExpiresAt: Date | null,
  animationExpiresAt: Date | null,
  supersededAt: Date | null,
};

export type TvEventPresentation = {
  takeover: TvPresentedTakeover | null,
  highlight: TvPresentedEventHighlight | null,
};

export function getTvEmailEvaluatorBounds(now: Date): {
  currentStartsAt: Date,
  currentEndsAt: Date,
  comparisonStartsAt: Date,
  comparisonEndsAt: Date,
} {
  return {
    currentStartsAt: new Date(now.getTime() - 20 * MINUTE_MS),
    currentEndsAt: new Date(now.getTime() - 5 * MINUTE_MS),
    comparisonStartsAt: new Date(now.getTime() - 35 * MINUTE_MS),
    comparisonEndsAt: new Date(now.getTime() - 20 * MINUTE_MS),
  };
}

function rate(delivered: number, finished: number): number {
  return finished === 0 ? 0 : Math.round(delivered / finished * 1000) / 10;
}

function readLastObservedTotal(typedState: unknown): number {
  if (
    typeof typedState === "object"
    && typedState != null
    && "lastObservedTotal" in typedState
    && typeof typedState.lastObservedTotal === "number"
  ) {
    return typedState.lastObservedTotal;
  }
  return 0;
}

async function eventTablesAreReady(tenancy: Tenancy): Promise<boolean> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$queryRaw<Array<{
    occurrences: string | null,
    evaluators: string | null,
    presentations: string | null,
  }>>`
    SELECT
      to_regclass(${`${schema}."TvEventOccurrence"`})::text AS occurrences,
      to_regclass(${`${schema}."TvEventEvaluatorState"`})::text AS evaluators,
      to_regclass(${`${schema}."TvProfileEventPresentation"`})::text AS presentations
  `;
  const row = rows.at(0);
  return row?.occurrences != null
    && row.evaluators != null
    && row.presentations != null;
}

async function claimEvaluator(
  tenancy: Tenancy,
  evaluatorKey: string,
  now: Date,
): Promise<EvaluatorClaimRow | null> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const nextEvaluationAt = new Date(now.getTime() + TV_EVENT_EVALUATION_INTERVAL_MS);
  const rows = await prisma.$queryRaw<EvaluatorClaimRow[]>`
    WITH claimed AS (
      INSERT INTO ${sqlQuoteIdent(schema)}."TvEventEvaluatorState" (
        "tenancyId", "evaluatorKey", "nextEvaluationAt", "typedState", "updatedAt"
      )
      VALUES (
        ${tenancy.id}::UUID, ${evaluatorKey}, ${nextEvaluationAt}, '{}'::JSONB, ${now}
      )
      ON CONFLICT ("tenancyId", "evaluatorKey")
      DO UPDATE SET
        "nextEvaluationAt" = EXCLUDED."nextEvaluationAt",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE ${sqlQuoteIdent(schema)}."TvEventEvaluatorState"."nextEvaluationAt" <= ${now}
      RETURNING *
    )
    SELECT
      claimed."breachCount",
      claimed."criticalBreachCount",
      claimed."recoveryCount",
      claimed."milestoneBaseline",
      claimed."typedState",
      claimed."activeOccurrenceId",
      occurrence."presentationClass" AS "activePresentationClass"
    FROM claimed
    LEFT JOIN ${sqlQuoteIdent(schema)}."TvEventOccurrence" occurrence
      ON occurrence."tenancyId" = claimed."tenancyId"
      AND occurrence."id" = claimed."activeOccurrenceId"
  `;
  return rows.at(0) ?? null;
}

async function loadEmailEvaluatorSample(
  tenancy: Tenancy,
  now: Date,
): Promise<TvEmailEvaluationSample> {
  const bounds = getTvEmailEvaluatorBounds(now);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$replica().$queryRaw<Array<{
    currentFinished: number,
    currentDelivered: number,
    comparisonFinished: number,
    comparisonDelivered: number,
  }>>`
    SELECT
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
          AND "finishedSendingAt" IS NOT NULL
      )::INT AS "currentFinished",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
          AND "finishedSendingAt" IS NOT NULL
          AND "deliveredAt" IS NOT NULL
      )::INT AS "currentDelivered",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.comparisonStartsAt}
          AND "createdAt" < ${bounds.comparisonEndsAt}
          AND "finishedSendingAt" IS NOT NULL
      )::INT AS "comparisonFinished",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.comparisonStartsAt}
          AND "createdAt" < ${bounds.comparisonEndsAt}
          AND "finishedSendingAt" IS NOT NULL
          AND "deliveredAt" IS NOT NULL
      )::INT AS "comparisonDelivered"
    FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "createdAt" >= ${bounds.comparisonStartsAt}
      AND "createdAt" < ${bounds.currentEndsAt}
  `;
  const sample = rows.at(0);
  if (sample == null) {
    throw new HexclaveAssertionError("The TV email evaluator query returned no aggregate row.");
  }
  return {
    currentFinishedSends: Number(sample.currentFinished),
    currentDeliveredSends: Number(sample.currentDelivered),
    comparisonFinishedSends: Number(sample.comparisonFinished),
    comparisonDeliveredSends: Number(sample.comparisonDelivered),
  };
}

function activeClassFromClaim(claim: EvaluatorClaimRow): TvEmailEvaluatorState["activeClass"] {
  if (claim.activePresentationClass === "CRITICAL_INCIDENT") return "critical-incident";
  if (claim.activePresentationClass === "INCIDENT") return "incident";
  return null;
}

async function persistEmailEvaluation(options: {
  tenancy: Tenancy,
  claim: EvaluatorClaimRow,
  sample: TvEmailEvaluationSample,
  now: Date,
}): Promise<void> {
  const schema = await getPrismaSchemaForTenancy(options.tenancy);
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const result = evaluateTvEmailDelivery({
    activeClass: activeClassFromClaim(options.claim),
    incidentBreachCount: Number(options.claim.breachCount),
    criticalBreachCount: Number(options.claim.criticalBreachCount),
    recoveryCount: Number(options.claim.recoveryCount),
  }, options.sample);
  await retryTransaction(prisma, async (transaction) => {
    let activeOccurrenceId = options.claim.activeOccurrenceId;
    const currentRate = rate(
      options.sample.currentDeliveredSends,
      options.sample.currentFinishedSends,
    );
    const comparisonRate = rate(
      options.sample.comparisonDeliveredSends,
      options.sample.comparisonFinishedSends,
    );
    const evidence = JSON.stringify({
      currentFinishedSends: options.sample.currentFinishedSends,
      currentDeliveredSends: options.sample.currentDeliveredSends,
      currentDeliveryRatePercent: currentRate,
      comparisonFinishedSends: options.sample.comparisonFinishedSends,
      comparisonDeliveredSends: options.sample.comparisonDeliveredSends,
      comparisonDeliveryRatePercent: comparisonRate,
    });

    if (result.action.type === "activate") {
      activeOccurrenceId = generateUuid();
      const presentationClass = result.action.presentationClass === "critical-incident"
        ? "CRITICAL_INCIDENT"
        : "INCIDENT";
      await transaction.$executeRaw`
        INSERT INTO ${sqlQuoteIdent(schema)}."TvEventOccurrence" (
          "id", "tenancyId", "eventType", "presentationClass", "lifecycle",
          "deduplicationKey", "title", "summary", "metricLabel", "metricValue",
          "expectedRange", "sourceLabel", "aggregateEvidence", "occurredAt",
          "detectedAt", "activatedAt", "updatedAt"
        )
        VALUES (
          ${activeOccurrenceId}::UUID,
          ${options.tenancy.id}::UUID,
          'EMAIL_DELIVERY_DEGRADATION'::${sqlQuoteIdent(schema)}."TvEventType",
          ${presentationClass}::${sqlQuoteIdent(schema)}."TvEventPresentationClass",
          'ACTIVE'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle",
          ${`email-delivery-degradation:${activeOccurrenceId}`},
          'Email delivery degraded',
          'Delivery performance is below its expected operating range.',
          'Delivery rate',
          ${`${currentRate}%`},
          'Expected 95% or higher',
          'Hexclave email',
          ${evidence}::JSONB,
          ${options.now},
          ${options.now},
          ${options.now},
          ${options.now}
        )
      `;
    } else if (result.action.type === "escalate") {
      if (activeOccurrenceId == null) {
        throw new HexclaveAssertionError("The TV email evaluator cannot escalate without an active occurrence.");
      }
      await transaction.$executeRaw`
        UPDATE ${sqlQuoteIdent(schema)}."TvEventOccurrence"
        SET
          "presentationClass" = 'CRITICAL_INCIDENT'::${sqlQuoteIdent(schema)}."TvEventPresentationClass",
          "escalatedAt" = ${options.now},
          "metricValue" = ${`${currentRate}%`},
          "aggregateEvidence" = ${evidence}::JSONB,
          "updatedAt" = ${options.now}
        WHERE "tenancyId" = ${options.tenancy.id}::UUID
          AND "id" = ${activeOccurrenceId}::UUID
          AND "lifecycle" = 'ACTIVE'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle"
      `;
    } else if (result.action.type === "resolve") {
      if (activeOccurrenceId == null) {
        throw new HexclaveAssertionError("The TV email evaluator cannot resolve without an active occurrence.");
      }
      await transaction.$executeRaw`
        UPDATE ${sqlQuoteIdent(schema)}."TvEventOccurrence"
        SET
          "lifecycle" = 'RESOLVED'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle",
          "resolvedAt" = ${options.now},
          "summary" = 'Email delivery has returned to its expected operating range.',
          "metricValue" = ${`${currentRate}%`},
          "aggregateEvidence" = ${evidence}::JSONB,
          "updatedAt" = ${options.now}
        WHERE "tenancyId" = ${options.tenancy.id}::UUID
          AND "id" = ${activeOccurrenceId}::UUID
          AND "lifecycle" = 'ACTIVE'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle"
      `;
      activeOccurrenceId = null;
    } else if (activeOccurrenceId != null) {
      await transaction.$executeRaw`
        UPDATE ${sqlQuoteIdent(schema)}."TvEventOccurrence"
        SET
          "metricValue" = ${`${currentRate}%`},
          "aggregateEvidence" = ${evidence}::JSONB,
          "updatedAt" = ${options.now}
        WHERE "tenancyId" = ${options.tenancy.id}::UUID
          AND "id" = ${activeOccurrenceId}::UUID
          AND "lifecycle" = 'ACTIVE'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle"
      `;
    }

    await transaction.$executeRaw`
      UPDATE ${sqlQuoteIdent(schema)}."TvEventEvaluatorState"
      SET
        "breachCount" = ${result.state.incidentBreachCount},
        "criticalBreachCount" = ${result.state.criticalBreachCount},
        "recoveryCount" = ${result.state.recoveryCount},
        "activeOccurrenceId" = ${activeOccurrenceId}::UUID,
        "updatedAt" = ${options.now}
      WHERE "tenancyId" = ${options.tenancy.id}::UUID
        AND "evaluatorKey" = 'email-delivery'
    `;
  });
}

async function evaluateEmailIfDue(tenancy: Tenancy, now: Date): Promise<void> {
  if (!(tenancy.config.apps.installed.emails?.enabled ?? false)) return;
  const claim = await claimEvaluator(tenancy, "email-delivery", now);
  if (claim == null) return;
  const sample = await loadEmailEvaluatorSample(tenancy, now);
  await persistEmailEvaluation({ tenancy, claim, sample, now });
}

async function evaluateMilestoneIfDue(
  tenancy: Tenancy,
  now: Date,
  totalUsers: number,
): Promise<void> {
  const claim = await claimEvaluator(tenancy, "user-milestone", now);
  if (claim == null) return;
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const result = evaluateTvUserMilestone({
    baselineEstablished: claim.milestoneBaseline != null,
    highestConsumedThreshold: Number(claim.milestoneBaseline ?? 0),
    lastObservedTotal: readLastObservedTotal(claim.typedState),
  }, totalUsers);

  await retryTransaction(prisma, async (transaction) => {
    if (result.crossedThreshold != null) {
      const occurrenceId = generateUuid();
      const formattedThreshold = new Intl.NumberFormat("en-US", {
        notation: result.crossedThreshold >= 1000 ? "compact" : "standard",
        maximumFractionDigits: 0,
      }).format(result.crossedThreshold);
      await transaction.$executeRaw`
        INSERT INTO ${sqlQuoteIdent(schema)}."TvEventOccurrence" (
          "id", "tenancyId", "eventType", "presentationClass", "lifecycle",
          "deduplicationKey", "title", "summary", "metricLabel", "metricValue",
          "sourceLabel", "aggregateEvidence", "occurredAt", "detectedAt", "activatedAt",
          "updatedAt"
        )
        VALUES (
          ${occurrenceId}::UUID,
          ${tenancy.id}::UUID,
          'USER_MILESTONE'::${sqlQuoteIdent(schema)}."TvEventType",
          'CELEBRATION'::${sqlQuoteIdent(schema)}."TvEventPresentationClass",
          'OCCURRED'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle",
          ${`user-milestone:${result.crossedThreshold}`},
          ${`${formattedThreshold} users`},
          'A new community milestone, reached together.',
          'Total users',
          ${new Intl.NumberFormat("en-US").format(totalUsers)},
          'Hexclave users',
          ${JSON.stringify({
            threshold: result.crossedThreshold,
            observedTotalUsers: totalUsers,
          })}::JSONB,
          ${now},
          ${now},
          ${now},
          ${now}
        )
        ON CONFLICT ("tenancyId", "deduplicationKey") DO NOTHING
      `;
    }
    await transaction.$executeRaw`
      UPDATE ${sqlQuoteIdent(schema)}."TvEventEvaluatorState"
      SET
        "milestoneBaseline" = ${BigInt(result.state.highestConsumedThreshold)},
        "typedState" = ${JSON.stringify({
          lastObservedTotal: result.state.lastObservedTotal,
        })}::JSONB,
        "updatedAt" = ${now}
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "evaluatorKey" = 'user-milestone'
    `;
  });
}

export async function evaluateTvEventsIfDue(options: {
  tenancy: Tenancy,
  now: Date,
  totalUsers: number | null,
}): Promise<void> {
  if (!(await eventTablesAreReady(options.tenancy))) return;
  try {
    await evaluateEmailIfDue(options.tenancy, options.now);
  } catch (cause) {
    captureError("tv-email-event-evaluator-failed", new HexclaveAssertionError(
      "The TV email event evaluator failed without affecting the operational snapshot.",
      { cause, tenancyId: options.tenancy.id },
    ));
  }
  if (options.totalUsers == null) return;
  try {
    await evaluateMilestoneIfDue(options.tenancy, options.now, options.totalUsers);
  } catch (cause) {
    captureError("tv-user-milestone-evaluator-failed", new HexclaveAssertionError(
      "The TV user milestone evaluator failed without affecting the operational snapshot.",
      { cause, tenancyId: options.tenancy.id },
    ));
  }
}

function addSeconds(timestamp: Date, seconds: number): Date {
  return new Date(timestamp.getTime() + seconds * 1000);
}

function presentationClass(occurrence: OccurrenceRow): TvDurableEventOccurrence["presentationClass"] {
  if (occurrence.presentationClass === "CELEBRATION") return "celebration";
  if (occurrence.presentationClass === "INCIDENT") return "incident";
  return "critical-incident";
}

function occurrenceLifecycle(occurrence: OccurrenceRow): TvDurableEventOccurrence["lifecycle"] {
  if (occurrence.lifecycle === "OCCURRED") return "occurred";
  if (occurrence.lifecycle === "ACTIVE") return "active";
  return "resolved";
}

function occurrenceType(occurrence: OccurrenceRow): TvDurableEventOccurrence["type"] {
  return occurrence.eventType === "USER_MILESTONE" ? "user-milestone" : "email-delivery-degradation";
}

function isEligible(
  occurrence: OccurrenceRow,
  preferences: TvInterruptionPreferences,
): boolean {
  return occurrence.eventType === "USER_MILESTONE"
    ? preferences.celebrations.userMilestone
    : preferences.incidentTypes.emailDeliveryDegradation;
}

async function loadOccurrences(
  tenancy: Tenancy,
  now: Date,
): Promise<OccurrenceRow[]> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const lookback = new Date(now.getTime() - MAX_EVENT_LOOKBACK_MS);
  return await prisma.$queryRaw<OccurrenceRow[]>`
    SELECT
      "id", "eventType", "presentationClass", "lifecycle", "title", "summary",
      "metricLabel", "metricValue", "expectedRange", "sourceLabel",
      "occurredAt", "activatedAt", "escalatedAt", "resolvedAt", "updatedAt"
    FROM ${sqlQuoteIdent(schema)}."TvEventOccurrence"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND (
        "lifecycle" = 'ACTIVE'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle"
        OR "occurredAt" >= ${lookback}
        OR "resolvedAt" >= ${lookback}
      )
    ORDER BY "occurredAt" DESC, "id"
  `;
}

async function synchronizeProfileAssignments(options: {
  tenancy: Tenancy,
  profile: TvProfileResource,
  occurrences: OccurrenceRow[],
  now: Date,
}): Promise<void> {
  const schema = await getPrismaSchemaForTenancy(options.tenancy);
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const preferences = options.profile.configuration.interruptionPreferences;
  const activeIncident = options.occurrences.some((occurrence) => (
    occurrence.lifecycle === "ACTIVE"
    && occurrence.presentationClass !== "CELEBRATION"
    && isEligible(occurrence, preferences)
  ));
  const recoveryConfirmationActive = options.occurrences.some((occurrence) => (
    occurrence.presentationClass !== "CELEBRATION"
    && occurrence.resolvedAt != null
    && options.now.getTime() < occurrence.resolvedAt.getTime() + TV_RECOVERY_CONFIRMATION_MS
    && isEligible(occurrence, preferences)
  ));
  const celebrationPresentationBlocked = activeIncident || recoveryConfirmationActive;
  const newestEligibleCelebrationId = options.occurrences.find((occurrence) => (
    occurrence.presentationClass === "CELEBRATION"
    && isEligible(occurrence, preferences)
  ))?.id ?? null;
  for (const occurrence of options.occurrences) {
    if (!isEligible(occurrence, preferences)) {
      await prisma.$executeRaw`
        UPDATE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"
        SET
          "supersededAt" = COALESCE("supersededAt", ${options.now}),
          "supersededReason" = COALESCE(
            "supersededReason",
            'POLICY_DISABLED'::${sqlQuoteIdent(schema)}."TvPresentationSupersededReason"
          ),
          "updatedAt" = ${options.now}
        WHERE "tenancyId" = ${options.tenancy.id}::UUID
          AND "profileId" = ${options.profile.id}
          AND "occurrenceId" = ${occurrence.id}::UUID
      `;
      continue;
    }

    if (occurrence.presentationClass === "CELEBRATION") {
      if (occurrence.id !== newestEligibleCelebrationId) continue;
      const highlightExpiresAt = addSeconds(
        occurrence.occurredAt,
        preferences.timing.celebration.highlightSeconds,
      );
      const animationExpiresAt = addSeconds(
        occurrence.occurredAt,
        preferences.timing.celebration.animationSeconds,
      );
      const expired = options.now.getTime() >= highlightExpiresAt.getTime();
      const takeoverStartedAt = celebrationPresentationBlocked || expired ? null : options.now;
      const takeoverEndsAt = takeoverStartedAt == null
        ? null
        : addSeconds(takeoverStartedAt, preferences.timing.celebration.takeoverSeconds);
      await retryTransaction(prisma, async (transaction) => {
        await transaction.$executeRaw`
          UPDATE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation" presentation
          SET
            "supersededAt" = ${options.now},
            "supersededReason" = 'NEWER_CELEBRATION'::${sqlQuoteIdent(schema)}."TvPresentationSupersededReason",
            "updatedAt" = ${options.now}
          FROM ${sqlQuoteIdent(schema)}."TvEventOccurrence" previous
          WHERE presentation."tenancyId" = ${options.tenancy.id}::UUID
            AND presentation."profileId" = ${options.profile.id}
            AND previous."tenancyId" = presentation."tenancyId"
            AND previous."id" = presentation."occurrenceId"
            AND previous."presentationClass" = 'CELEBRATION'::${sqlQuoteIdent(schema)}."TvEventPresentationClass"
            AND previous."occurredAt" < ${occurrence.occurredAt}
            AND presentation."supersededAt" IS NULL
        `;
        await transaction.$executeRaw`
          INSERT INTO ${sqlQuoteIdent(schema)}."TvProfileEventPresentation" (
            "tenancyId", "profileId", "occurrenceId", "takeoverStartedAt",
            "takeoverEndsAt", "highlightExpiresAt", "animationExpiresAt",
            "supersededAt", "supersededReason", "updatedAt"
          )
          VALUES (
            ${options.tenancy.id}::UUID,
            ${options.profile.id},
            ${occurrence.id}::UUID,
            ${takeoverStartedAt},
            ${takeoverEndsAt},
            ${highlightExpiresAt},
            ${animationExpiresAt},
            ${expired ? options.now : null},
            ${expired ? "EXPIRED_BEFORE_PRESENTATION" : null}::${sqlQuoteIdent(schema)}."TvPresentationSupersededReason",
            ${options.now}
          )
          ON CONFLICT ("tenancyId", "profileId", "occurrenceId") DO NOTHING
        `;
      });
      continue;
    }

    const takeoverStartedAt = occurrence.presentationClass === "CRITICAL_INCIDENT"
      ? occurrence.escalatedAt ?? occurrence.activatedAt ?? occurrence.occurredAt
      : occurrence.activatedAt ?? occurrence.occurredAt;
    const takeoverEndsAt = occurrence.presentationClass === "CRITICAL_INCIDENT"
      ? null
      : addSeconds(takeoverStartedAt, preferences.timing.incident.takeoverSeconds);
    const resolvedHighlightSeconds = occurrence.presentationClass === "CRITICAL_INCIDENT"
      ? preferences.timing.criticalIncident.resolvedHighlightSeconds
      : preferences.timing.incident.resolvedHighlightSeconds;
    const highlightExpiresAt = occurrence.resolvedAt == null
      ? null
      : addSeconds(occurrence.resolvedAt, resolvedHighlightSeconds);
    await prisma.$executeRaw`
      INSERT INTO ${sqlQuoteIdent(schema)}."TvProfileEventPresentation" (
        "tenancyId", "profileId", "occurrenceId", "takeoverStartedAt",
        "takeoverEndsAt", "highlightExpiresAt", "updatedAt"
      )
      VALUES (
        ${options.tenancy.id}::UUID,
        ${options.profile.id},
        ${occurrence.id}::UUID,
        ${takeoverStartedAt},
        ${takeoverEndsAt},
        ${highlightExpiresAt},
        ${options.now}
      )
      ON CONFLICT ("tenancyId", "profileId", "occurrenceId")
      DO UPDATE SET
        "takeoverStartedAt" = CASE
          WHEN ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverEndsAt" IS NOT NULL
            AND EXCLUDED."takeoverEndsAt" IS NULL
            THEN EXCLUDED."takeoverStartedAt"
          ELSE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverStartedAt"
        END,
        "takeoverEndsAt" = CASE
          WHEN ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverEndsAt" IS NOT NULL
            AND EXCLUDED."takeoverEndsAt" IS NULL
            THEN NULL
          ELSE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverEndsAt"
        END,
        "highlightExpiresAt" = COALESCE(
          EXCLUDED."highlightExpiresAt",
          ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."highlightExpiresAt"
        ),
        "updatedAt" = EXCLUDED."updatedAt"
    `;
  }

  if (!celebrationPresentationBlocked) {
    const pending = await prisma.$queryRaw<Array<{
      occurrenceId: string,
      occurredAt: Date,
      highlightExpiresAt: Date,
    }>>`
      SELECT
        presentation."occurrenceId",
        occurrence."occurredAt",
        presentation."highlightExpiresAt"
      FROM ${sqlQuoteIdent(schema)}."TvProfileEventPresentation" presentation
      JOIN ${sqlQuoteIdent(schema)}."TvEventOccurrence" occurrence
        ON occurrence."tenancyId" = presentation."tenancyId"
        AND occurrence."id" = presentation."occurrenceId"
      WHERE presentation."tenancyId" = ${options.tenancy.id}::UUID
        AND presentation."profileId" = ${options.profile.id}
        AND occurrence."presentationClass" = 'CELEBRATION'::${sqlQuoteIdent(schema)}."TvEventPresentationClass"
        AND presentation."takeoverStartedAt" IS NULL
        AND presentation."supersededAt" IS NULL
      ORDER BY occurrence."occurredAt" DESC, occurrence."id"
      LIMIT 1
    `;
    const candidate = pending.at(0);
    if (candidate != null) {
      if (options.now.getTime() >= candidate.highlightExpiresAt.getTime()) {
        await prisma.$executeRaw`
          UPDATE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"
          SET
            "supersededAt" = ${options.now},
            "supersededReason" = 'EXPIRED_BEFORE_PRESENTATION'::${sqlQuoteIdent(schema)}."TvPresentationSupersededReason",
            "updatedAt" = ${options.now}
          WHERE "tenancyId" = ${options.tenancy.id}::UUID
            AND "profileId" = ${options.profile.id}
            AND "occurrenceId" = ${candidate.occurrenceId}::UUID
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"
          SET
            "takeoverStartedAt" = ${options.now},
            "takeoverEndsAt" = ${addSeconds(
              options.now,
              preferences.timing.celebration.takeoverSeconds,
            )},
            "updatedAt" = ${options.now}
          WHERE "tenancyId" = ${options.tenancy.id}::UUID
            AND "profileId" = ${options.profile.id}
            AND "occurrenceId" = ${candidate.occurrenceId}::UUID
            AND "takeoverStartedAt" IS NULL
            AND "supersededAt" IS NULL
        `;
      }
    }
  }
}

async function loadAssignments(
  tenancy: Tenancy,
  profileId: string,
): Promise<AssignmentRow[]> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  return await prisma.$queryRaw<AssignmentRow[]>`
    SELECT
      "occurrenceId", "takeoverStartedAt", "takeoverEndsAt",
      "highlightExpiresAt", "animationExpiresAt", "supersededAt"
    FROM ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "profileId" = ${profileId}
  `;
}

function snapshotEvent(occurrence: OccurrenceRow): TvEvent {
  return {
    id: occurrence.id,
    type: occurrenceType(occurrence),
    presentationClass: presentationClass(occurrence),
    status: occurrence.lifecycle === "RESOLVED" ? "resolved" : "active",
    title: occurrence.title,
    summary: occurrence.summary,
    metricLabel: occurrence.metricLabel,
    metricValue: occurrence.metricValue,
    expectedRange: occurrence.expectedRange,
    sourceLabel: occurrence.sourceLabel,
    occurredAt: occurrence.occurredAt.toISOString(),
    updatedAt: occurrence.updatedAt.toISOString(),
  };
}

export async function resolveTvEventPresentation(options: {
  tenancy: Tenancy,
  profile: TvProfileResource,
  now: Date,
}): Promise<TvEventPresentation> {
  if (!(await eventTablesAreReady(options.tenancy))) {
    return { takeover: null, highlight: null };
  }
  const occurrences = await loadOccurrences(options.tenancy, options.now);
  await synchronizeProfileAssignments({ ...options, occurrences });
  const assignments = await loadAssignments(options.tenancy, options.profile.id);
  const durableOccurrences: TvDurableEventOccurrence[] = occurrences.map((occurrence) => ({
    id: occurrence.id,
    type: occurrenceType(occurrence),
    presentationClass: presentationClass(occurrence),
    lifecycle: occurrenceLifecycle(occurrence),
    occurredAt: occurrence.occurredAt,
    activatedAt: occurrence.activatedAt ?? occurrence.occurredAt,
    resolvedAt: occurrence.resolvedAt,
  }));
  const durableAssignments: TvDurablePresentationAssignment[] = assignments.map((assignment) => ({
    occurrenceId: assignment.occurrenceId,
    takeoverStartedAt: assignment.takeoverStartedAt,
    takeoverEndsAt: assignment.takeoverEndsAt,
    highlightExpiresAt: assignment.highlightExpiresAt,
    animationExpiresAt: assignment.animationExpiresAt,
    supersededAt: assignment.supersededAt,
  }));
  const derived = deriveTvPresentation({
    now: options.now,
    occurrences: durableOccurrences,
    assignments: durableAssignments,
  });
  const occurrencesById = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const takeoverOccurrence = derived.takeover == null
    ? null
    : occurrencesById.get(derived.takeover.occurrenceId);
  const highlightOccurrence = derived.highlight == null
    ? null
    : occurrencesById.get(derived.highlight.occurrenceId);
  if (derived.takeover != null && takeoverOccurrence == null) {
    throw new HexclaveAssertionError("The derived TV takeover references an unavailable occurrence.");
  }
  if (derived.highlight != null && highlightOccurrence == null) {
    throw new HexclaveAssertionError("The derived TV Highlight references an unavailable occurrence.");
  }
  return {
    takeover: derived.takeover == null || takeoverOccurrence == null ? null : {
      event: snapshotEvent(takeoverOccurrence),
      variant: derived.takeover.variant,
      startedAt: derived.takeover.startedAt.toISOString(),
      endsAt: derived.takeover.endsAt?.toISOString() ?? null,
    },
    highlight: derived.highlight == null || highlightOccurrence == null ? null : {
      event: snapshotEvent(highlightOccurrence),
      variant: derived.highlight.variant,
      expiresAt: derived.highlight.expiresAt?.toISOString() ?? null,
      animationExpiresAt: derived.highlight.animationExpiresAt?.toISOString() ?? null,
    },
  };
}

export { TV_RECOVERY_CONFIRMATION_MS };
