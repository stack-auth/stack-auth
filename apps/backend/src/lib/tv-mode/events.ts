import { type Tenancy } from "@/lib/tenancies";
import {
  calculateTvEmailEvidenceRate,
  createTvEmailEvaluatorState,
  evaluateTvEmailDelivery,
  evaluateTvUserMilestone,
  median,
  TV_EVENT_EVALUATION_INTERVAL_MS,
  TV_EMAIL_BASELINE_DAYS,
  TV_EMAIL_BASELINE_REFRESH_MS,
  TV_EMAIL_CURRENT_WINDOW_MINUTES,
  TV_EMAIL_LOW_VOLUME_WINDOW_MINUTES,
  TV_EMAIL_MATURITY_DELAY_MINUTES,
  TV_EMAIL_RECOVERY_TITLE,
  TV_EMAIL_RULE_VERSION,
  type TvEmailBaseline,
  type TvEmailEvidenceWindow,
  type TvEmailEvaluationSample,
  type TvEmailEvaluatorState,
} from "@/lib/tv-mode/event-evaluators";
import {
  deriveTvPresentation,
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

export type EvaluatorClaimRow = {
  breachCount: number,
  criticalBreachCount: number,
  recoveryCount: number,
  milestoneBaseline: bigint | null,
  typedState: unknown,
  activeOccurrenceId: string | null,
  activePresentationClass: "CELEBRATION" | "INCIDENT" | "CRITICAL_INCIDENT" | null,
  activeAggregateEvidence: unknown,
};

export type TvEventOccurrenceRow = {
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
  recoveryEndsAt: Date | null,
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
  lowVolumeStartsAt: Date,
  lowVolumeEndsAt: Date,
} {
  const currentEndsAt = new Date(now.getTime() - TV_EMAIL_MATURITY_DELAY_MINUTES * MINUTE_MS);
  return {
    currentStartsAt: new Date(currentEndsAt.getTime() - TV_EMAIL_CURRENT_WINDOW_MINUTES * MINUTE_MS),
    currentEndsAt,
    lowVolumeStartsAt: new Date(currentEndsAt.getTime() - TV_EMAIL_LOW_VOLUME_WINDOW_MINUTES * MINUTE_MS),
    lowVolumeEndsAt: currentEndsAt,
  };
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

export async function claimEvaluator(
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
      occurrence."presentationClass" AS "activePresentationClass",
      occurrence."aggregateEvidence" AS "activeAggregateEvidence"
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
  baseline: TvEmailBaseline | null,
): Promise<TvEmailEvaluationSample> {
  const bounds = getTvEmailEvaluatorBounds(now);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$replica().$queryRaw<Array<{
    currentFinished: number,
    currentDelivered: number,
    currentBounced: number,
    currentServerError: number,
    currentTotal: number,
    lowVolumeFinished: number,
    lowVolumeDelivered: number,
    lowVolumeBounced: number,
    lowVolumeServerError: number,
    lowVolumeTotal: number,
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
          AND "deliveredAt" IS NOT NULL
      )::INT AS "currentDelivered",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
          AND "bouncedAt" IS NOT NULL
      )::INT AS "currentBounced",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
          AND "bouncedAt" IS NULL
          AND "sendServerErrorExternalMessage" IS NOT NULL
      )::INT AS "currentServerError",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.currentStartsAt}
          AND "createdAt" < ${bounds.currentEndsAt}
      )::INT AS "currentTotal",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.lowVolumeStartsAt}
          AND "createdAt" < ${bounds.lowVolumeEndsAt}
          AND "finishedSendingAt" IS NOT NULL
      )::INT AS "lowVolumeFinished",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.lowVolumeStartsAt}
          AND "createdAt" < ${bounds.lowVolumeEndsAt}
          AND "deliveredAt" IS NOT NULL
      )::INT AS "lowVolumeDelivered",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.lowVolumeStartsAt}
          AND "createdAt" < ${bounds.lowVolumeEndsAt}
          AND "bouncedAt" IS NOT NULL
      )::INT AS "lowVolumeBounced",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.lowVolumeStartsAt}
          AND "createdAt" < ${bounds.lowVolumeEndsAt}
          AND "bouncedAt" IS NULL
          AND "sendServerErrorExternalMessage" IS NOT NULL
      )::INT AS "lowVolumeServerError",
      COUNT(*) FILTER (
        WHERE "createdAt" >= ${bounds.lowVolumeStartsAt}
          AND "createdAt" < ${bounds.lowVolumeEndsAt}
      )::INT AS "lowVolumeTotal"
    FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "createdAt" >= ${bounds.lowVolumeStartsAt}
      AND "createdAt" < ${bounds.lowVolumeEndsAt}
  `;
  const sample = rows.at(0);
  if (sample == null) {
    throw new HexclaveAssertionError("The TV email evaluator query returned no aggregate row.");
  }
  const evidenceWindow = (window: {
    startsAt: Date,
    endsAt: Date,
    finished: number,
    delivered: number,
    bounced: number,
    serverError: number,
    total: number,
  }): TvEmailEvidenceWindow => {
    const explicitFailures = window.bounced + window.serverError;
    const rates = calculateTvEmailEvidenceRate(window.delivered, explicitFailures);
    return {
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      finishedSends: window.finished,
      deliveredSends: window.delivered,
      bouncedSends: window.bounced,
      serverErrorSends: window.serverError,
      neutralOrUnknownSends: Math.max(0, window.total - window.delivered - explicitFailures),
      explicitFailures,
      ...rates,
    };
  };
  const current = evidenceWindow({
    startsAt: bounds.currentStartsAt,
    endsAt: bounds.currentEndsAt,
    finished: Number(sample.currentFinished),
    delivered: Number(sample.currentDelivered),
    bounced: Number(sample.currentBounced),
    serverError: Number(sample.currentServerError),
    total: Number(sample.currentTotal),
  });
  const lowVolume = evidenceWindow({
    startsAt: bounds.lowVolumeStartsAt,
    endsAt: bounds.lowVolumeEndsAt,
    finished: Number(sample.lowVolumeFinished),
    delivered: Number(sample.lowVolumeDelivered),
    bounced: Number(sample.lowVolumeBounced),
    serverError: Number(sample.lowVolumeServerError),
    total: Number(sample.lowVolumeTotal),
  });
  return {
    status: current.assessableSends < 20 && lowVolume.assessableSends < 20 ? "insufficient" : "fresh",
    evaluatedAt: now.toISOString(),
    observedAt: bounds.currentEndsAt.toISOString(),
    current,
    lowVolume,
    baseline,
  };
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function readNumber(value: object, key: string): number | null {
  if (!(key in value)) return null;
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readString(value: object, key: string): string | null {
  if (!(key in value)) return null;
  const candidate: unknown = Reflect.get(value, key);
  return typeof candidate === "string" ? candidate : null;
}

function readTvEmailBaseline(value: unknown): TvEmailBaseline | null {
  if (!isObject(value)) return null;
  const startsAt = readString(value, "startsAt");
  const endsAt = readString(value, "endsAt");
  const computedAt = readString(value, "computedAt");
  const assessableSends = readNumber(value, "assessableSends");
  const qualifiedDays = readNumber(value, "qualifiedDays");
  if (!("days" in value) || !Array.isArray(value.days)) return null;
  const days: TvEmailBaseline["days"] = [];
  for (const dayValue of value.days) {
    if (!isObject(dayValue)) return null;
    const day = readString(dayValue, "day");
    const deliveredSends = readNumber(dayValue, "deliveredSends");
    const explicitFailures = readNumber(dayValue, "explicitFailures");
    const assessableForDay = readNumber(dayValue, "assessableSends");
    const deliveryRatePercent = readNumber(dayValue, "deliveryRatePercent");
    if (day == null || deliveredSends == null || explicitFailures == null || assessableForDay == null || deliveryRatePercent == null) return null;
    days.push({ day, deliveredSends, explicitFailures, assessableSends: assessableForDay, deliveryRatePercent });
  }
  if (
    startsAt == null
    || endsAt == null
    || computedAt == null
    || assessableSends == null
    || qualifiedDays == null
  ) return null;
  const medianDeliveryRatePercent = "medianDeliveryRatePercent" in value
    && value.medianDeliveryRatePercent == null
    ? null
    : readNumber(value, "medianDeliveryRatePercent");
  return {
    startsAt,
    endsAt,
    computedAt,
    assessableSends,
    qualifiedDays,
    days,
    medianDeliveryRatePercent,
  };
}

export function readTvEmailState(value: unknown, activeClass: TvEmailEvaluatorState["activeClass"]): TvEmailEvaluatorState {
  if (!isObject(value) || readNumber(value, "ruleVersion") !== TV_EMAIL_RULE_VERSION) {
    return createTvEmailEvaluatorState({ activeClass });
  }
  const baseline = "baseline" in value ? readTvEmailBaseline(value.baseline) : null;
  const lastFreshEvaluatedAt = "lastFreshEvaluatedAt" in value && value.lastFreshEvaluatedAt == null
    ? null
    : readString(value, "lastFreshEvaluatedAt");
  let candidate: TvEmailEvaluatorState["candidate"] = null;
  if ("candidate" in value && isObject(value.candidate)) {
    const rulePath = readString(value.candidate, "rulePath");
    const presentationClass = readString(value.candidate, "presentationClass");
    const accumulatedMs = readNumber(value.candidate, "accumulatedMs");
    const borderlineEvaluations = readNumber(value.candidate, "borderlineEvaluations");
    if (
      (rulePath === "standard" || rulePath === "low-volume" || rulePath === "strict-standard" || rulePath === "strict-low-volume" || rulePath === "critical" || rulePath === "high-impact")
      && (presentationClass === "incident" || presentationClass === "critical-incident")
      && accumulatedMs != null
      && borderlineEvaluations != null
    ) {
      candidate = { rulePath, presentationClass, accumulatedMs, borderlineEvaluations };
    }
  }
  let recovery: TvEmailEvaluatorState["recovery"] = null;
  if ("recovery" in value && isObject(value.recovery)) {
    const window = readString(value.recovery, "window");
    const accumulatedMs = readNumber(value.recovery, "accumulatedMs");
    if ((window === "current" || window === "low-volume") && accumulatedMs != null) {
      recovery = { window, accumulatedMs };
    }
  }
  return {
    ruleVersion: TV_EMAIL_RULE_VERSION,
    activeClass,
    candidate,
    recovery,
    lastFreshEvaluatedAt,
    baseline,
  };
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

async function loadTvEmailBaseline(tenancy: Tenancy, now: Date): Promise<TvEmailBaseline> {
  // End before the UTC day containing the longest live window so the baseline never
  // learns from evidence that it is simultaneously evaluating as current degradation.
  const endsAt = startOfUtcDay(getTvEmailEvaluatorBounds(now).lowVolumeStartsAt);
  const startsAt = new Date(endsAt.getTime() - TV_EMAIL_BASELINE_DAYS * 24 * 60 * MINUTE_MS);
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const rows = await prisma.$replica().$queryRaw<Array<{
    day: Date,
    delivered: number,
    failures: number,
    assessable: number,
  }>>`
    WITH daily AS (
      SELECT
        date_trunc('day', "createdAt") AS day,
        COUNT(*) FILTER (WHERE "deliveredAt" IS NOT NULL)::INT AS delivered,
        COUNT(*) FILTER (
          WHERE "bouncedAt" IS NOT NULL
            OR ("bouncedAt" IS NULL AND "sendServerErrorExternalMessage" IS NOT NULL)
        )::INT AS failures
      FROM ${sqlQuoteIdent(schema)}."EmailOutbox"
      WHERE "tenancyId" = ${tenancy.id}::UUID
        AND "createdAt" >= ${startsAt}
        AND "createdAt" < ${endsAt}
      GROUP BY day
    )
    SELECT day, delivered, failures, delivered + failures AS assessable
    FROM daily
    WHERE delivered + failures >= 10
    ORDER BY day
  `;
  return buildTvEmailBaseline({ startsAt, endsAt, computedAt: now, rows });
}

export function buildTvEmailBaseline(options: {
  startsAt: Date,
  endsAt: Date,
  computedAt: Date,
  rows: Array<{ day: Date, delivered: number, failures: number, assessable: number }>,
}): TvEmailBaseline {
  const days = options.rows.map((row) => {
    const rates = calculateTvEmailEvidenceRate(Number(row.delivered), Number(row.failures));
    if (rates.deliveryRatePercent == null) {
      throw new HexclaveAssertionError("A qualified TV email baseline day has no assessable sends.");
    }
    return {
      day: row.day.toISOString(),
      deliveredSends: Number(row.delivered),
      explicitFailures: Number(row.failures),
      assessableSends: Number(row.assessable),
      deliveryRatePercent: rates.deliveryRatePercent,
    };
  });
  const assessableSends = options.rows.reduce((total, row) => total + Number(row.assessable), 0);
  const qualifiedDays = options.rows.length;
  return {
    startsAt: options.startsAt.toISOString(),
    endsAt: options.endsAt.toISOString(),
    computedAt: options.computedAt.toISOString(),
    assessableSends,
    qualifiedDays,
    days,
    medianDeliveryRatePercent: assessableSends >= 100 && qualifiedDays >= 7
      ? median(days.map((day) => day.deliveryRatePercent))
      : null,
  };
}

function baselineNeedsRefresh(baseline: TvEmailBaseline | null, now: Date): boolean {
  return baseline == null
    || now.getTime() - new Date(baseline.computedAt).getTime() >= TV_EMAIL_BASELINE_REFRESH_MS;
}

function activeClassFromClaim(claim: EvaluatorClaimRow): TvEmailEvaluatorState["activeClass"] {
  if (claim.activePresentationClass === "CRITICAL_INCIDENT") return "critical-incident";
  if (claim.activePresentationClass === "INCIDENT") return "incident";
  return null;
}

function emailQualificationEvidence(qualification: ReturnType<typeof evaluateTvEmailDelivery>["qualification"]): {
  requiredPersistenceMs: number,
  thresholds: Record<string, number>,
} | null {
  if (qualification === "standard") return {
    requiredPersistenceMs: 3 * MINUTE_MS,
    thresholds: { minimumAssessableSends: 50, minimumExplicitFailures: 5, deliveryRateBelowPercent: 95, minimumBaselineDropPoints: 5 },
  };
  if (qualification === "low-volume") return {
    requiredPersistenceMs: 10 * MINUTE_MS,
    thresholds: { minimumAssessableSends: 20, minimumExplicitFailures: 3, deliveryRateBelowPercent: 85, minimumBaselineDropPoints: 10 },
  };
  if (qualification === "strict-standard") return {
    requiredPersistenceMs: 5 * MINUTE_MS,
    thresholds: { minimumAssessableSends: 50, minimumExplicitFailures: 10, deliveryRateBelowPercent: 85 },
  };
  if (qualification === "strict-low-volume") return {
    requiredPersistenceMs: 15 * MINUTE_MS,
    thresholds: { minimumAssessableSends: 20, minimumExplicitFailures: 5, deliveryRateBelowPercent: 75 },
  };
  if (qualification === "critical") return {
    requiredPersistenceMs: MINUTE_MS,
    thresholds: { minimumAssessableSends: 20, minimumExplicitFailures: 10, deliveryRateBelowPercent: 80 },
  };
  if (qualification === "high-impact") return {
    requiredPersistenceMs: 0,
    thresholds: { minimumExplicitFailures: 50, minimumExplicitFailureRatePercent: 10 },
  };
  if (qualification === "recovery") return {
    requiredPersistenceMs: 0,
    thresholds: {},
  };
  return null;
}

export async function persistEmailEvaluation(options: {
  tenancy: Tenancy,
  claim: EvaluatorClaimRow,
  previousState: TvEmailEvaluatorState,
  sample: TvEmailEvaluationSample,
  now: Date,
}): Promise<void> {
  const schema = await getPrismaSchemaForTenancy(options.tenancy);
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const result = evaluateTvEmailDelivery(options.previousState, options.sample);
  await retryTransaction(prisma, async (transaction) => {
    let activeOccurrenceId = options.claim.activeOccurrenceId;
    const rulePath = result.qualification;
    const relevantWindow = rulePath === "low-volume" || rulePath === "strict-low-volume"
      ? options.sample.lowVolume
      : options.sample.current;
    const currentRate = relevantWindow?.deliveryRatePercent ?? null;
    const roundedRate = currentRate == null ? null : Math.round(currentRate * 10) / 10;
    const qualificationEvidence = rulePath === "recovery"
      ? {
          requiredPersistenceMs: (options.previousState.recovery?.window === "low-volume" ? 15 : 5) * MINUTE_MS,
          thresholds: options.sample.baseline?.medianDeliveryRatePercent == null
            ? { minimumDeliveryRatePercent: 97, maximumExplicitFailureRatePercent: 3 }
            : { minimumDeliveryRatePercent: Math.max(90, options.sample.baseline.medianDeliveryRatePercent - 2) },
        }
      : emailQualificationEvidence(rulePath);
    const observationEvidence = {
      evaluatedAt: options.sample.evaluatedAt,
      observedAt: options.sample.observedAt,
      sourceStatus: options.sample.status,
      qualification: rulePath,
      qualificationEvidence,
      accumulatedMs: result.action.type === "activate" || result.action.type === "escalate"
        ? qualificationEvidence?.requiredPersistenceMs ?? 0
        : result.action.type === "resolve"
          ? qualificationEvidence?.requiredPersistenceMs ?? 0
        : result.state.candidate?.accumulatedMs ?? result.state.recovery?.accumulatedMs ?? 0,
      current: options.sample.current,
      lowVolume: options.sample.lowVolume,
      baseline: options.sample.baseline,
    };
    const previousEvidence = isObject(options.claim.activeAggregateEvidence)
      ? options.claim.activeAggregateEvidence
      : {};
    const metricValue = roundedRate == null ? "Unavailable" : `${roundedRate}%`;
    const expectedRange = options.sample.baseline?.medianDeliveryRatePercent == null
      ? "Expected delivery range"
      : `Typical daily delivery ${Math.round(options.sample.baseline.medianDeliveryRatePercent * 10) / 10}%`;

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
          'Email Delivery Degraded',
          ${"Email delivery is below the expected range. We’re monitoring recovery."},
          'Delivery rate',
          ${metricValue},
          ${expectedRange},
          'Hexclave email',
          ${JSON.stringify({ ruleVersion: TV_EMAIL_RULE_VERSION, activation: observationEvidence, latestActiveObservation: observationEvidence })}::JSONB,
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
          "metricValue" = ${metricValue},
          "expectedRange" = ${expectedRange},
          "aggregateEvidence" = ${JSON.stringify({ ...previousEvidence, ruleVersion: TV_EMAIL_RULE_VERSION, escalation: observationEvidence, latestActiveObservation: observationEvidence })}::JSONB,
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
          "title" = ${TV_EMAIL_RECOVERY_TITLE},
          "summary" = 'Email delivery is back within the expected range.',
          "metricValue" = ${metricValue},
          "expectedRange" = ${expectedRange},
          "aggregateEvidence" = ${JSON.stringify({ ...previousEvidence, ruleVersion: TV_EMAIL_RULE_VERSION, resolution: observationEvidence })}::JSONB,
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
          "metricValue" = ${metricValue},
          "expectedRange" = ${expectedRange},
          "aggregateEvidence" = ${JSON.stringify({ ...previousEvidence, ruleVersion: TV_EMAIL_RULE_VERSION, latestActiveObservation: observationEvidence })}::JSONB,
          "updatedAt" = ${options.now}
        WHERE "tenancyId" = ${options.tenancy.id}::UUID
          AND "id" = ${activeOccurrenceId}::UUID
          AND "lifecycle" = 'ACTIVE'::${sqlQuoteIdent(schema)}."TvEventOccurrenceLifecycle"
      `;
    }

    await transaction.$executeRaw`
      UPDATE ${sqlQuoteIdent(schema)}."TvEventEvaluatorState"
      SET
        "breachCount" = 0,
        "criticalBreachCount" = 0,
        "recoveryCount" = 0,
        "typedState" = ${JSON.stringify(result.state)}::JSONB,
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
  const state = readTvEmailState(claim.typedState, activeClassFromClaim(claim));
  let baseline = state.baseline;
  if (baselineNeedsRefresh(baseline, now)) {
    baseline = await loadTvEmailBaseline(tenancy, now).then(
      (loaded) => loaded,
      (cause: unknown) => {
        captureError("tv-email-baseline-refresh-failed", new HexclaveAssertionError(
          "The TV email evaluator baseline refresh failed; evaluation will use the last cached baseline or strict fallback rules.",
          { cause, tenancyId: tenancy.id },
        ));
        return baseline;
      },
    );
  }
  const sample = await loadEmailEvaluatorSample(tenancy, now, baseline);
  await persistEmailEvaluation({ tenancy, claim, previousState: state, sample, now });
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
          ${`${formattedThreshold} Users`},
          'The community reached a new milestone—worth celebrating together.',
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

function presentationClass(occurrence: TvEventOccurrenceRow): TvDurableEventOccurrence["presentationClass"] {
  if (occurrence.presentationClass === "CELEBRATION") return "celebration";
  if (occurrence.presentationClass === "INCIDENT") return "incident";
  return "critical-incident";
}

function occurrenceLifecycle(occurrence: TvEventOccurrenceRow): TvDurableEventOccurrence["lifecycle"] {
  if (occurrence.lifecycle === "OCCURRED") return "occurred";
  if (occurrence.lifecycle === "ACTIVE") return "active";
  return "resolved";
}

function occurrenceType(occurrence: TvEventOccurrenceRow): TvDurableEventOccurrence["type"] {
  return occurrence.eventType === "USER_MILESTONE" ? "user-milestone" : "email-delivery-degradation";
}

function isEligible(
  occurrence: TvEventOccurrenceRow,
  preferences: TvInterruptionPreferences,
): boolean {
  return occurrence.eventType === "USER_MILESTONE"
    ? preferences.celebrations.userMilestone
    : preferences.incidentTypes.emailDeliveryDegradation;
}

async function loadOccurrences(
  tenancy: Tenancy,
  now: Date,
): Promise<TvEventOccurrenceRow[]> {
  const schema = await getPrismaSchemaForTenancy(tenancy);
  const prisma = await getPrismaClientForTenancy(tenancy);
  const lookback = new Date(now.getTime() - MAX_EVENT_LOOKBACK_MS);
  return await prisma.$queryRaw<TvEventOccurrenceRow[]>`
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

export async function synchronizeTvProfileAssignments(options: {
  tenancy: Tenancy,
  profile: TvProfileResource,
  occurrences: TvEventOccurrenceRow[],
  now: Date,
}): Promise<void> {
  const schema = await getPrismaSchemaForTenancy(options.tenancy);
  const prisma = await getPrismaClientForTenancy(options.tenancy);
  const preferences = options.profile.configuration.interruptionPreferences;
  const existingAssignments = new Map(
    (await loadAssignments(options.tenancy, options.profile.id)).map((assignment) => [assignment.occurrenceId, assignment]),
  );
  const activeIncident = options.occurrences.some((occurrence) => (
    occurrence.lifecycle === "ACTIVE"
    && occurrence.presentationClass !== "CELEBRATION"
    && isEligible(occurrence, preferences)
  ));
  const recoveryConfirmationActive = options.occurrences.some((occurrence) => (
    occurrence.presentationClass !== "CELEBRATION"
    && occurrence.resolvedAt != null
    && options.now.getTime() < (
      existingAssignments.get(occurrence.id)?.recoveryEndsAt
      ?? addSeconds(
        occurrence.resolvedAt,
        occurrence.presentationClass === "CRITICAL_INCIDENT"
          ? preferences.timing.criticalIncident.recoveryTakeoverSeconds
          : preferences.timing.incident.recoveryTakeoverSeconds,
      )
    ).getTime()
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
      ? addSeconds(takeoverStartedAt, preferences.timing.criticalIncident.takeoverSeconds)
      : addSeconds(takeoverStartedAt, preferences.timing.incident.takeoverSeconds);
    const recoveryEndsAt = occurrence.resolvedAt == null
      ? null
      : addSeconds(
        occurrence.resolvedAt,
        occurrence.presentationClass === "CRITICAL_INCIDENT"
          ? preferences.timing.criticalIncident.recoveryTakeoverSeconds
          : preferences.timing.incident.recoveryTakeoverSeconds,
      );
    const resolvedHighlightSeconds = occurrence.presentationClass === "CRITICAL_INCIDENT"
      ? preferences.timing.criticalIncident.resolvedHighlightSeconds
      : preferences.timing.incident.resolvedHighlightSeconds;
    const highlightExpiresAt = occurrence.resolvedAt == null
      ? null
      : addSeconds(occurrence.resolvedAt, resolvedHighlightSeconds);
    await prisma.$executeRaw`
      INSERT INTO ${sqlQuoteIdent(schema)}."TvProfileEventPresentation" (
        "tenancyId", "profileId", "occurrenceId", "takeoverStartedAt",
        "takeoverEndsAt", "recoveryEndsAt", "highlightExpiresAt", "updatedAt"
      )
      VALUES (
        ${options.tenancy.id}::UUID,
        ${options.profile.id},
        ${occurrence.id}::UUID,
        ${takeoverStartedAt},
        ${takeoverEndsAt},
        ${recoveryEndsAt},
        ${highlightExpiresAt},
        ${options.now}
      )
      ON CONFLICT ("tenancyId", "profileId", "occurrenceId")
      DO UPDATE SET
        "takeoverStartedAt" = CASE
          WHEN EXCLUDED."takeoverStartedAt" > ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverStartedAt"
            THEN EXCLUDED."takeoverStartedAt"
          ELSE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverStartedAt"
        END,
        "takeoverEndsAt" = CASE
          WHEN EXCLUDED."takeoverStartedAt" > ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverStartedAt"
            THEN EXCLUDED."takeoverEndsAt"
          ELSE ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."takeoverEndsAt"
        END,
        "recoveryEndsAt" = COALESCE(
          ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."recoveryEndsAt",
          EXCLUDED."recoveryEndsAt"
        ),
        -- A resolved Highlight is also an assigned phase. Preserve its original
        -- deadline so profile edits only affect future resolutions.
        "highlightExpiresAt" = COALESCE(
          ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"."highlightExpiresAt",
          EXCLUDED."highlightExpiresAt"
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
      "recoveryEndsAt", "highlightExpiresAt", "animationExpiresAt", "supersededAt"
    FROM ${sqlQuoteIdent(schema)}."TvProfileEventPresentation"
    WHERE "tenancyId" = ${tenancy.id}::UUID
      AND "profileId" = ${profileId}
  `;
}

function snapshotEvent(occurrence: TvEventOccurrenceRow): TvEvent {
  const title = occurrence.eventType === "EMAIL_DELIVERY_DEGRADATION"
    ? occurrence.lifecycle === "RESOLVED" ? TV_EMAIL_RECOVERY_TITLE : "Email Delivery Degraded"
    : occurrence.title.replace(/ users$/i, " Users");
  return {
    id: occurrence.id,
    type: occurrenceType(occurrence),
    presentationClass: presentationClass(occurrence),
    status: occurrence.lifecycle === "RESOLVED" ? "resolved" : "active",
    // Normalize persisted copy at the snapshot boundary so occurrences created
    // before a wording update render consistently with newly detected events.
    title,
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
  await synchronizeTvProfileAssignments({ ...options, occurrences });
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
    recoveryEndsAt: assignment.recoveryEndsAt,
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
      endsAt: derived.takeover.endsAt.toISOString(),
    },
    highlight: derived.highlight == null || highlightOccurrence == null ? null : {
      event: snapshotEvent(highlightOccurrence),
      variant: derived.highlight.variant,
      expiresAt: derived.highlight.expiresAt?.toISOString() ?? null,
      animationExpiresAt: derived.highlight.animationExpiresAt?.toISOString() ?? null,
    },
  };
}
