import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { urlString } from "@hexclave/shared/dist/utils/urls";

/**
 * Frontend-local adapter around the *intended* feature-flags admin SDK surface.
 *
 * INTEGRATION NOTE: the admin SDK (packages/template `StackAdminApp`) will grow
 * first-class methods for these operations:
 *
 *   adminApp.listExperimentRuns()                → listExperimentRuns(adminApp)
 *   adminApp.getExperimentRun(experimentId)      → getExperimentRun(adminApp, id)
 *   adminApp.startExperimentRun(experimentId)    → transitionExperimentRun(adminApp, id, "start")
 *   adminApp.pauseExperimentRun(experimentId)    → transitionExperimentRun(adminApp, id, "pause")
 *   adminApp.resumeExperimentRun(experimentId)   → transitionExperimentRun(adminApp, id, "resume")
 *   adminApp.completeExperimentRun(experimentId, options) → completeExperimentRun(...)
 *   adminApp.getExperimentResults(experimentId, filters)  → getExperimentResults(...)
 *   adminApp.getFeatureFlagActivity(filters)     → getFeatureFlagActivity(adminApp, filters)
 *   (tester) adminApp.evaluateFeatureFlag({ recordExposure: false, ... }) → evaluateFlagWithoutExposure(...)
 *
 * When those methods land, each function below becomes a one-line delegation
 * (or callers switch to the SDK directly) — keep the response types identical
 * to the SDK's return types so the swap is mechanical. Until the backend
 * routes exist, every call throws `FeatureFlagsBackendUnavailableError`, which
 * pages must surface as an explicit "not available yet" state.
 *
 * This module deliberately mirrors the transport style of
 * `@/lib/hexclave-app-internals` (typed accessor over the internals symbol)
 * rather than duplicating any backend evaluation or statistics logic.
 */

export class FeatureFlagsBackendUnavailableError extends Error {
  constructor() {
    super("The feature-flags backend endpoints are not available on this server yet.");
    this.name = "FeatureFlagsBackendUnavailableError";
  }
}

type SendRequest = (path: string, requestOptions: RequestInit, requestType?: "client" | "server" | "admin") => Promise<Response>;

function getSendRequestOrThrow(adminApp: object): SendRequest {
  const internals = Reflect.get(adminApp, hexclaveAppInternalsSymbol);
  if (internals == null || typeof internals !== "object") {
    throw new HexclaveAssertionError("Admin app internals are unavailable — cannot reach the feature-flags backend.");
  }
  const sendRequest: unknown = Reflect.get(internals, "sendRequest");
  if (typeof sendRequest !== "function") {
    throw new HexclaveAssertionError("Admin app internals do not expose sendRequest.");
  }
  // The one narrowing in this module: internals are untyped by design, and the
  // shape was just verified above. Any drift is still caught at runtime by the
  // response validation below.
  return sendRequest.bind(internals) as SendRequest;
}

async function requestJson(adminApp: object, path: string, init: RequestInit): Promise<unknown> {
  const response = await getSendRequestOrThrow(adminApp)(path, init, "admin");
  // 404 means the backend workstream hasn't shipped these routes yet (the
  // route handler system 404s unknown paths); 501 is the explicit
  // not-implemented signal. Both are the "unavailable" state, not an error.
  if (response.status === 404 || response.status === 501) {
    throw new FeatureFlagsBackendUnavailableError();
  }
  if (!response.ok) {
    throw new HexclaveAssertionError(`Feature-flags backend request failed: ${path} → ${response.status}`);
  }
  return await response.json();
}

class AdapterResponseShapeError extends HexclaveAssertionError {
  constructor(path: string, expectation: string) {
    super(`Unexpected feature-flags backend response at ${path}: expected ${expectation}`);
  }
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new AdapterResponseShapeError(path, "an object");
  return Object.fromEntries(Object.entries(value));
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new AdapterResponseShapeError(path, "an array");
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new AdapterResponseShapeError(path, "a string");
  return value;
}

function asStringOrNull(value: unknown, path: string): string | null {
  if (value == null) return null;
  return asString(value, path);
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AdapterResponseShapeError(path, "a finite number");
  return value;
}

function asNumberOrNull(value: unknown, path: string): number | null {
  if (value == null) return null;
  return asNumber(value, path);
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new AdapterResponseShapeError(path, "a boolean");
  return value;
}

function asOneOf<const T extends readonly string[]>(value: unknown, options: T, path: string): T[number] {
  const text = asString(value, path);
  // find() (rather than includes()) keeps the literal-union element type
  // without needing a cast on the way out.
  const match = options.find((option) => option === text);
  if (match == null) throw new AdapterResponseShapeError(path, `one of ${options.join(", ")}`);
  return match;
}

// ---------------------------------------------------------------------------
// Experiment runs
// ---------------------------------------------------------------------------

export type ExperimentRunStatus = "draft" | "scheduled" | "running" | "paused" | "completed";

export type ExperimentRun = {
  experimentId: string,
  status: ExperimentRunStatus,
  startedAtIso: string | null,
  completedAtIso: string | null,
  totalExposures: number,
  exposuresByVariant: { variantId: string, exposures: number }[],
  /** Set once a winner has been declared on completion. */
  winnerVariantId: string | null,
};

function parseExperimentRun(value: unknown, path: string): ExperimentRun {
  const record = asRecord(value, path);
  return {
    experimentId: asString(record.experimentId, `${path}.experimentId`),
    status: asOneOf(record.status, ["draft", "scheduled", "running", "paused", "completed"] as const, `${path}.status`),
    startedAtIso: asStringOrNull(record.startedAtIso, `${path}.startedAtIso`),
    completedAtIso: asStringOrNull(record.completedAtIso, `${path}.completedAtIso`),
    totalExposures: asNumber(record.totalExposures, `${path}.totalExposures`),
    exposuresByVariant: asArray(record.exposuresByVariant, `${path}.exposuresByVariant`).map((entry, index) => {
      const entryRecord = asRecord(entry, `${path}.exposuresByVariant[${index}]`);
      return {
        variantId: asString(entryRecord.variantId, `${path}.exposuresByVariant[${index}].variantId`),
        exposures: asNumber(entryRecord.exposures, `${path}.exposuresByVariant[${index}].exposures`),
      };
    }),
    winnerVariantId: asStringOrNull(record.winnerVariantId, `${path}.winnerVariantId`),
  };
}

export async function listExperimentRuns(adminApp: object): Promise<ExperimentRun[]> {
  const body = asRecord(await requestJson(adminApp, "/internal/feature-flags/experiment-runs", { method: "GET" }), "$");
  return asArray(body.runs, "$.runs").map((run, index) => parseExperimentRun(run, `$.runs[${index}]`));
}

export async function getExperimentRun(adminApp: object, experimentId: string): Promise<ExperimentRun> {
  return parseExperimentRun(
    await requestJson(adminApp, urlString`/internal/feature-flags/experiment-runs/${experimentId}`, { method: "GET" }),
    "$",
  );
}

export type ExperimentRunTransition = "start" | "pause" | "resume";

export async function transitionExperimentRun(adminApp: object, experimentId: string, transition: ExperimentRunTransition): Promise<ExperimentRun> {
  return parseExperimentRun(
    await requestJson(adminApp, urlString`/internal/feature-flags/experiment-runs/${experimentId}/${transition}`, { method: "POST" }),
    "$",
  );
}

export async function completeExperimentRun(
  adminApp: object,
  experimentId: string,
  options: { winnerVariantId: string | null },
): Promise<ExperimentRun> {
  return parseExperimentRun(
    await requestJson(adminApp, urlString`/internal/feature-flags/experiment-runs/${experimentId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winnerVariantId: options.winnerVariantId }),
    }),
    "$",
  );
}

// ---------------------------------------------------------------------------
// Experiment results
// ---------------------------------------------------------------------------

export type ExperimentResultsFilters = {
  segmentId?: string,
  sinceIso?: string,
  untilIso?: string,
};

export type ExperimentMetricVariantResult = {
  variantId: string,
  exposures: number,
  /** Conversions for event metrics; aggregated value for numeric metrics. */
  value: number,
  conversionRate: number | null,
  /** Relative lift vs. the control variant; null for the control itself. */
  liftVsControl: number | null,
  credibleIntervalLow: number,
  credibleIntervalHigh: number,
  /** Posterior probability that this variant is the best one. */
  probabilityBest: number,
};

export type ExperimentMetricResult = {
  metricId: string,
  perVariant: ExperimentMetricVariantResult[],
  /** Only meaningful for guardrail metrics. */
  guardrailBreached: boolean,
};

export type ExperimentResults = {
  totalExposures: number,
  exposuresByVariant: { variantId: string, exposures: number, expectedBps: number }[],
  /** Sample-ratio mismatch check — allocation drift that invalidates results. */
  srm: { detected: boolean, pValue: number },
  metrics: ExperimentMetricResult[],
  /** True while the sample is too small for the intervals to be meaningful. */
  insufficientData: boolean,
  minimumExposuresPerVariant: number,
};

export async function getExperimentResults(
  adminApp: object,
  experimentId: string,
  filters: ExperimentResultsFilters,
): Promise<ExperimentResults> {
  const params = new URLSearchParams();
  if (filters.segmentId != null) params.append("segment_id", filters.segmentId);
  if (filters.sinceIso != null) params.append("since", filters.sinceIso);
  if (filters.untilIso != null) params.append("until", filters.untilIso);
  const query = params.toString();
  const body = asRecord(
    await requestJson(adminApp, `${urlString`/internal/feature-flags/experiment-runs/${experimentId}/results`}${query ? `?${query}` : ""}`, { method: "GET" }),
    "$",
  );
  const srm = asRecord(body.srm, "$.srm");
  return {
    totalExposures: asNumber(body.totalExposures, "$.totalExposures"),
    exposuresByVariant: asArray(body.exposuresByVariant, "$.exposuresByVariant").map((entry, index) => {
      const entryRecord = asRecord(entry, `$.exposuresByVariant[${index}]`);
      return {
        variantId: asString(entryRecord.variantId, `$.exposuresByVariant[${index}].variantId`),
        exposures: asNumber(entryRecord.exposures, `$.exposuresByVariant[${index}].exposures`),
        expectedBps: asNumber(entryRecord.expectedBps, `$.exposuresByVariant[${index}].expectedBps`),
      };
    }),
    srm: {
      detected: asBoolean(srm.detected, "$.srm.detected"),
      pValue: asNumber(srm.pValue, "$.srm.pValue"),
    },
    metrics: asArray(body.metrics, "$.metrics").map((metric, metricIndex) => {
      const metricRecord = asRecord(metric, `$.metrics[${metricIndex}]`);
      return {
        metricId: asString(metricRecord.metricId, `$.metrics[${metricIndex}].metricId`),
        guardrailBreached: asBoolean(metricRecord.guardrailBreached, `$.metrics[${metricIndex}].guardrailBreached`),
        perVariant: asArray(metricRecord.perVariant, `$.metrics[${metricIndex}].perVariant`).map((variant, variantIndex) => {
          const variantPath = `$.metrics[${metricIndex}].perVariant[${variantIndex}]`;
          const variantRecord = asRecord(variant, variantPath);
          return {
            variantId: asString(variantRecord.variantId, `${variantPath}.variantId`),
            exposures: asNumber(variantRecord.exposures, `${variantPath}.exposures`),
            value: asNumber(variantRecord.value, `${variantPath}.value`),
            conversionRate: asNumberOrNull(variantRecord.conversionRate, `${variantPath}.conversionRate`),
            liftVsControl: asNumberOrNull(variantRecord.liftVsControl, `${variantPath}.liftVsControl`),
            credibleIntervalLow: asNumber(variantRecord.credibleIntervalLow, `${variantPath}.credibleIntervalLow`),
            credibleIntervalHigh: asNumber(variantRecord.credibleIntervalHigh, `${variantPath}.credibleIntervalHigh`),
            probabilityBest: asNumber(variantRecord.probabilityBest, `${variantPath}.probabilityBest`),
          };
        }),
      };
    }),
    insufficientData: asBoolean(body.insufficientData, "$.insufficientData"),
    minimumExposuresPerVariant: asNumber(body.minimumExposuresPerVariant, "$.minimumExposuresPerVariant"),
  };
}

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

export type FeatureFlagActivityKind = "audit" | "lifecycle" | "exposure_summary";

export type FeatureFlagActivityEntry = {
  id: string,
  timestampIso: string,
  kind: FeatureFlagActivityKind,
  flagKey: string | null,
  experimentId: string | null,
  /** Display name / email of the dashboard user for audit entries. */
  actor: string | null,
  message: string,
};

export type FeatureFlagActivityFilters = {
  kind?: FeatureFlagActivityKind,
  flagKey?: string,
  experimentId?: string,
};

export async function getFeatureFlagActivity(adminApp: object, filters: FeatureFlagActivityFilters): Promise<FeatureFlagActivityEntry[]> {
  const params = new URLSearchParams();
  if (filters.kind != null) params.append("kind", filters.kind);
  if (filters.flagKey != null) params.append("flag_key", filters.flagKey);
  if (filters.experimentId != null) params.append("experiment_id", filters.experimentId);
  const query = params.toString();
  const body = asRecord(await requestJson(adminApp, `/internal/feature-flags/activity${query ? `?${query}` : ""}`, { method: "GET" }), "$");
  return asArray(body.entries, "$.entries").map((entry, index) => {
    const entryRecord = asRecord(entry, `$.entries[${index}]`);
    return {
      id: asString(entryRecord.id, `$.entries[${index}].id`),
      timestampIso: asString(entryRecord.timestampIso, `$.entries[${index}].timestampIso`),
      kind: asOneOf(entryRecord.kind, ["audit", "lifecycle", "exposure_summary"] as const, `$.entries[${index}].kind`),
      flagKey: asStringOrNull(entryRecord.flagKey, `$.entries[${index}].flagKey`),
      experimentId: asStringOrNull(entryRecord.experimentId, `$.entries[${index}].experimentId`),
      actor: asStringOrNull(entryRecord.actor, `$.entries[${index}].actor`),
      message: asString(entryRecord.message, `$.entries[${index}].message`),
    };
  });
}

/**
 * Per-flag "last exposure" timestamps for the flags list. Part of the same
 * intended activity surface (`adminApp.getFeatureFlagActivity`).
 */
export async function getLastExposures(adminApp: object): Promise<Map<string, string>> {
  const body = asRecord(await requestJson(adminApp, "/internal/feature-flags/last-exposures", { method: "GET" }), "$");
  return new Map(Object.entries(asRecord(body.lastExposureIsoByFlagKey, "$.lastExposureIsoByFlagKey"))
    .map(([flagKey, iso]): [string, string] => [flagKey, asString(iso, `$.lastExposureIsoByFlagKey.${flagKey}`)]));
}

// ---------------------------------------------------------------------------
// Evaluator tester (dry-run — never records an exposure)
// ---------------------------------------------------------------------------

export type FlagEvaluationContext = {
  userId: string | null,
  email: string | null,
  teamId: string | null,
  environment: string | null,
  /** Free-form custom attributes matched by "custom.<name>" rule attributes. */
  customAttributes: Map<string, string>,
};

export type FlagEvaluationResult = {
  variantId: string,
  /** JSON-encoded evaluated value, same encoding as `FlagVariant.jsonValue`. */
  jsonValue: string,
  /** Human-readable explanation of why this variant was served. */
  reason: string,
  matchedRuleId: string | null,
};

export async function evaluateFlagWithoutExposure(
  adminApp: object,
  flagKey: string,
  context: FlagEvaluationContext,
): Promise<FlagEvaluationResult> {
  const body = asRecord(
    await requestJson(adminApp, "/internal/feature-flags/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        flagKey,
        // The tester must never pollute experiment stats, so exposure
        // recording is explicitly off — the backend contract treats this as a
        // pure dry run.
        recordExposure: false,
        context: {
          userId: context.userId,
          email: context.email,
          teamId: context.teamId,
          environment: context.environment,
          customAttributes: Object.fromEntries(context.customAttributes),
        },
      }),
    }),
    "$",
  );
  return {
    variantId: asString(body.variantId, "$.variantId"),
    jsonValue: asString(body.jsonValue, "$.jsonValue"),
    reason: asString(body.reason, "$.reason"),
    matchedRuleId: asStringOrNull(body.matchedRuleId, "$.matchedRuleId"),
  };
}
