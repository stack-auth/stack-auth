import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { type Json } from "@hexclave/shared/dist/utils/json";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { urlString } from "@hexclave/shared/dist/utils/urls";

export class FeatureFlagsBackendUnavailableError extends Error {
  constructor() {
    super("The feature-flags backend endpoints are not available on this server yet.");
    this.name = "FeatureFlagsBackendUnavailableError";
  }
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
  return value == null ? null : asString(value, path);
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AdapterResponseShapeError(path, "a finite number");
  return value;
}

function asNumberOrNull(value: unknown, path: string): number | null {
  return value == null ? null : asNumber(value, path);
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new AdapterResponseShapeError(path, "a boolean");
  return value;
}

function asJson(value: unknown, path: string): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AdapterResponseShapeError(path, "a finite JSON number");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => asJson(entry, `${path}[${index}]`));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, asJson(entry, `${path}.${key}`)]));
  }
  throw new AdapterResponseShapeError(path, "a JSON value");
}

function asOneOf<const T extends readonly string[]>(value: unknown, options: T, path: string): T[number] {
  const text = asString(value, path);
  const match = options.find((option) => option === text);
  if (match == null) throw new AdapterResponseShapeError(path, `one of ${options.join(", ")}`);
  return match;
}

async function requestJson(adminApp: object, path: string, init: RequestInit): Promise<unknown> {
  const internals = Reflect.get(adminApp, hexclaveAppInternalsSymbol);
  if (internals == null || typeof internals !== "object") {
    throw new HexclaveAssertionError("Admin app internals are unavailable — cannot reach the feature-flags backend.");
  }
  const sendRequest: unknown = Reflect.get(internals, "sendRequest");
  if (typeof sendRequest !== "function") throw new HexclaveAssertionError("Admin app internals do not expose sendRequest.");
  const pending: unknown = Reflect.apply(sendRequest, internals, [path, init, "admin"]);
  if (!(pending instanceof Promise)) throw new HexclaveAssertionError("Admin app sendRequest did not return a promise.");
  const response: unknown = await pending;
  if (!(response instanceof Response)) throw new HexclaveAssertionError("Admin app sendRequest did not return a Response.");
  if (response.status === 404 || response.status === 501) throw new FeatureFlagsBackendUnavailableError();
  if (!response.ok) throw new HexclaveAssertionError(`Feature-flags backend request failed: ${path} → ${response.status}`);
  return await response.json();
}

export type ExperimentRunStatus = "not_started" | "draft" | "scheduled" | "running" | "paused" | "completed";

export type ExperimentRun = {
  runId: string | null,
  experimentId: string,
  status: ExperimentRunStatus,
  startedAtIso: string | null,
  completedAtIso: string | null,
};

type ParsedRun = Omit<ExperimentRun, "runId" | "status"> & {
  runId: string,
  status: Exclude<ExperimentRunStatus, "not_started">,
  configSnapshot: Record<string, unknown>,
};

function makeNotStartedRun(experimentId: string): ExperimentRun {
  return {
    runId: null,
    experimentId,
    status: "not_started",
    startedAtIso: null,
    completedAtIso: null,
  };
}

function parseExperimentRun(value: unknown, path: string): ParsedRun {
  const record = asRecord(value, path);
  const state = asOneOf(record.state, ["draft", "running", "paused", "completed"] as const, `${path}.state`);
  const scheduledStartAt = asNumberOrNull(record.scheduled_start_at_millis, `${path}.scheduled_start_at_millis`);
  const startedAt = asNumberOrNull(record.started_at_millis, `${path}.started_at_millis`);
  const completedAt = asNumberOrNull(record.completed_at_millis, `${path}.completed_at_millis`);
  return {
    runId: asString(record.id, `${path}.id`),
    experimentId: asString(record.experiment_id, `${path}.experiment_id`),
    status: state === "draft" && scheduledStartAt != null ? "scheduled" : state,
    startedAtIso: startedAt == null ? null : new Date(startedAt).toISOString(),
    completedAtIso: completedAt == null ? null : new Date(completedAt).toISOString(),
    configSnapshot: asRecord(record.config_snapshot, `${path}.config_snapshot`),
  };
}

async function listRunsForExperiment(adminApp: object, experimentId: string): Promise<ParsedRun[]> {
  const body = asRecord(await requestJson(adminApp, urlString`/internal/feature-flags/experiments/${experimentId}/runs`, { method: "GET" }), "$");
  return asArray(body.items, "$.items").map((run, index) => parseExperimentRun(run, `$.items[${index}]`));
}

export async function listExperimentRuns(adminApp: object, experimentIds: readonly string[]): Promise<ExperimentRun[]> {
  const groups = await Promise.all(experimentIds.map(async (experimentId) => await listRunsForExperiment(adminApp, experimentId)));
  return groups.flatMap((runs) => runs.slice(0, 1).map((run) => {
    const { configSnapshot: _configSnapshot, ...publicRun } = run;
    return publicRun;
  }));
}

export async function getExperimentRun(adminApp: object, experimentId: string): Promise<ExperimentRun> {
  const runs = await listRunsForExperiment(adminApp, experimentId);
  const run = runs.at(0);
  if (run == null) return makeNotStartedRun(experimentId);
  // Lifecycle controls must stay available even when ClickHouse results are
  // slow or unavailable. Results are loaded once, independently, by the detail
  // page instead of making run metadata depend on analytical computation.
  const { configSnapshot: _configSnapshot, ...publicRun } = run;
  return publicRun;
}

function throwRunRequired(experimentId: string): never {
  throw new HexclaveAssertionError(`Experiment ${experimentId} must have a run before its lifecycle can change.`);
}

export async function createExperimentRun(adminApp: object, experimentId: string, experimentConfig: object): Promise<ExperimentRun> {
  return parseExperimentRun(await requestJson(adminApp, urlString`/internal/feature-flags/experiments/${experimentId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ experiment_config: experimentConfig }),
  }), "$");
}

export type ExperimentRunTransition = "start" | "pause" | "resume";

export async function transitionExperimentRun(adminApp: object, experimentId: string, transition: ExperimentRunTransition): Promise<ExperimentRun> {
  const run = (await listRunsForExperiment(adminApp, experimentId)).at(0) ?? throwRunRequired(experimentId);
  return parseExperimentRun(await requestJson(adminApp, urlString`/internal/feature-flags/experiments/${experimentId}/runs/${run.runId}/${transition}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }), "$");
}

export async function completeExperimentRun(adminApp: object, experimentId: string, _options: { winnerVariantId: string | null }): Promise<ExperimentRun> {
  const run = (await listRunsForExperiment(adminApp, experimentId)).at(0) ?? throwRunRequired(experimentId);
  return parseExperimentRun(await requestJson(adminApp, urlString`/internal/feature-flags/experiments/${experimentId}/runs/${run.runId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  }), "$");
}

export type ExperimentResultsFilters = { sinceIso?: string, untilIso?: string };
export type ExperimentMetricVariantResult = {
  variantId: string,
  exposures: number,
  value: number,
  conversionRate: number | null,
  liftVsControl: number | null,
  credibleIntervalLow: number,
  credibleIntervalHigh: number,
  probabilityBest: number,
};
export type ExperimentMetricResult = { metricId: string, perVariant: ExperimentMetricVariantResult[], guardrailBreached: boolean };
export type ExperimentResults = {
  controlVariantId: string,
  totalExposures: number,
  exposuresByVariant: { variantId: string, exposures: number, expectedBps: number }[],
  srm: { detected: boolean, pValue: number | null },
  metrics: ExperimentMetricResult[],
  insufficientData: boolean,
  minimumExposuresPerVariant: number,
  winnerVariantId: string | null,
  winnerRollout: { variantId: string, flagValue: Json } | null,
};

function expectedWeights(run: ParsedRun): Map<string, number> {
  const variants = asRecord(run.configSnapshot.variants, "$.config_snapshot.variants");
  return new Map(Object.entries(variants).map(([variantId, value]) => {
    const variant = asRecord(value, `$.config_snapshot.variants.${variantId}`);
    return [variantId, asNumber(variant.weight_basis_points, `$.config_snapshot.variants.${variantId}.weight_basis_points`)];
  }));
}

export async function getExperimentResults(adminApp: object, experimentId: string, filters: ExperimentResultsFilters): Promise<ExperimentResults | null> {
  const runs = await listRunsForExperiment(adminApp, experimentId);
  const run = runs.at(0);
  // Results only exist after enrollment starts. Treat the absence of a run (or
  // a run waiting to start) as a normal lifecycle state and avoid sending a
  // request that the results endpoint must reject.
  if (run == null || run.status === "draft" || run.status === "scheduled") return null;
  const params = new URLSearchParams();
  if (filters.sinceIso !== undefined) params.set("since", filters.sinceIso);
  if (filters.untilIso !== undefined) params.set("until", filters.untilIso);
  const suffix = params.size === 0 ? "" : `?${params.toString()}`;
  const basePath = urlString`/internal/feature-flags/experiments/${experimentId}/runs/${run.runId}/results`;
  const body = asRecord(await requestJson(adminApp, `${basePath}${suffix}`, { method: "GET" }), "$");
  const exposed = asRecord(body.exposed_subjects_by_variant, "$.exposed_subjects_by_variant");
  const weights = expectedWeights(run);
  const controlVariantId = asString(run.configSnapshot.control_variant_id, "$.config_snapshot.control_variant_id");
  const minimum = asNumber(body.min_exposed_subjects_for_winner, "$.min_exposed_subjects_for_winner");
  const metrics = asArray(body.metrics, "$.metrics").map((metricValue, metricIndex): ExperimentMetricResult => {
    const metric = asRecord(metricValue, `$.metrics[${metricIndex}]`);
    const kind = asOneOf(metric.kind, ["binary", "numeric", "funnel"] as const, `$.metrics[${metricIndex}].kind`);
    const variantsWithMeans = asArray(metric.variants, `$.metrics[${metricIndex}].variants`).map((variantValue, variantIndex) => {
      const variant = asRecord(variantValue, `$.metrics[${metricIndex}].variants[${variantIndex}]`);
      const exposures = asNumber(variant.exposed_subjects, `$.metrics[${metricIndex}].variants[${variantIndex}].exposed_subjects`);
      const converted = asNumberOrNull(variant.converted_subjects, `$.metrics[${metricIndex}].variants[${variantIndex}].converted_subjects`);
      const interval = asRecord(variant.credible_interval_95, `$.metrics[${metricIndex}].variants[${variantIndex}].credible_interval_95`);
      const posteriorMean = asNumber(variant.posterior_mean, `$.metrics[${metricIndex}].variants[${variantIndex}].posterior_mean`);
      return {
        variantId: asString(variant.variant_id, `$.metrics[${metricIndex}].variants[${variantIndex}].variant_id`),
        exposures,
        value: kind === "numeric" ? posteriorMean : converted ?? 0,
        conversionRate: kind === "numeric" || converted == null || exposures === 0 ? null : converted / exposures,
        credibleIntervalLow: asNumber(interval.lower, `$.metrics[${metricIndex}].variants[${variantIndex}].credible_interval_95.lower`),
        credibleIntervalHigh: asNumber(interval.upper, `$.metrics[${metricIndex}].variants[${variantIndex}].credible_interval_95.upper`),
        probabilityBest: asNumber(variant.probability_best, `$.metrics[${metricIndex}].variants[${variantIndex}].probability_best`),
        posteriorMean,
      };
    });
    const controlMean = variantsWithMeans.find((variant) => variant.variantId === controlVariantId)?.posteriorMean
      ?? (() => { throw new AdapterResponseShapeError(`$.metrics[${metricIndex}].variants`, `the control variant ${controlVariantId}`); })();
    const variants: ExperimentMetricVariantResult[] = variantsWithMeans.map(({ posteriorMean, ...variant }) => ({
      ...variant,
      // Relative lift is undefined against a zero baseline. The control itself
      // remains the 0% reference so the table can distinguish it from an
      // uncomputable treatment lift.
      liftVsControl: variant.variantId === controlVariantId
        ? 0
        : controlMean === 0 ? null : (posteriorMean - controlMean) / Math.abs(controlMean),
    }));
    return {
      metricId: asString(metric.metric_id, `$.metrics[${metricIndex}].metric_id`),
      perVariant: variants,
      guardrailBreached: variants.some((_variant, index) => {
        const raw = asRecord(asArray(metric.variants, `$.metrics[${metricIndex}].variants`)[index], `$.metrics[${metricIndex}].variants[${index}]`);
        return raw.is_guardrail_regression === true;
      }),
    };
  });
  const srm = asRecord(body.srm, "$.srm");
  const winner = asRecord(body.winner, "$.winner");
  const winnerVariantId = winner.status === "winner" ? asString(winner.variant_id, "$.winner.variant_id") : null;
  const winnerRolloutRecord = body.winner_rollout == null ? null : asRecord(body.winner_rollout, "$.winner_rollout");
  return {
    controlVariantId,
    totalExposures: asNumber(body.total_exposed_subjects, "$.total_exposed_subjects"),
    exposuresByVariant: Object.entries(exposed).map(([variantId, count]) => ({ variantId, exposures: asNumber(count, `$.exposed_subjects_by_variant.${variantId}`), expectedBps: weights.get(variantId) ?? 0 })),
    srm: { detected: asBoolean(srm.detected, "$.srm.detected"), pValue: asNumberOrNull(srm.p_value, "$.srm.p_value") },
    metrics,
    insufficientData: Object.entries(exposed).some(([variantId, count]) =>
      (weights.get(variantId) ?? 0) > 0 && asNumber(count, `$.exposed_subjects_by_variant.${variantId}`) < minimum),
    minimumExposuresPerVariant: minimum,
    winnerVariantId,
    winnerRollout: winnerRolloutRecord == null ? null : {
      variantId: asString(winnerRolloutRecord.variant_id, "$.winner_rollout.variant_id"),
      flagValue: asJson(winnerRolloutRecord.flag_value, "$.winner_rollout.flag_value"),
    },
  };
}

export type FeatureFlagActivityKind = "lifecycle";
export type FeatureFlagLifecycleAction = "created" | "started" | "paused" | "resumed" | "completed" | "revision_created";
export type FeatureFlagActivityEntry = { id: string, timestampIso: string, kind: FeatureFlagActivityKind, action: FeatureFlagLifecycleAction, resourceId: string, experimentId: string | null, actorType: string, actor: string | null, source: string, message: string };
export type FeatureFlagActivityFilters = { experimentId?: string, action?: FeatureFlagLifecycleAction };

const FEATURE_FLAG_LIFECYCLE_ACTIONS = ["created", "started", "paused", "resumed", "completed", "revision_created"] as const;
const LIFECYCLE_MESSAGES: ReadonlyMap<FeatureFlagLifecycleAction, string> = new Map([
  ["created", "Experiment run created"],
  ["started", "Experiment run started"],
  ["paused", "Experiment run paused"],
  ["resumed", "Experiment run resumed"],
  ["completed", "Experiment run completed"],
  ["revision_created", "Experiment revision created"],
]);

export async function getFeatureFlagActivity(adminApp: object, filters: FeatureFlagActivityFilters): Promise<FeatureFlagActivityEntry[]> {
  const runs = filters.experimentId === undefined ? [] : await listRunsForExperiment(adminApp, filters.experimentId);
  const resourceIds = filters.experimentId === undefined ? [null] : runs.map((run) => run.runId);
  const bodies = await Promise.all(resourceIds.map(async (resourceId) => {
    const params = new URLSearchParams();
    if (resourceId != null) {
      params.set("resource_type", "experiment_run");
      params.set("resource_id", resourceId);
    }
    const suffix = params.size === 0 ? "" : `?${params.toString()}`;
    return asRecord(await requestJson(adminApp, `/internal/feature-flags/activity${suffix}`, { method: "GET" }), "$");
  }));
  return bodies.flatMap((body) => asArray(body.items, "$.items")).map((entryValue, index): FeatureFlagActivityEntry => {
    const entry = asRecord(entryValue, `$.items[${index}]`);
    const actorId = asStringOrNull(entry.actor_id, `$.items[${index}].actor_id`);
    const resourceType = asString(entry.resource_type, `$.items[${index}].resource_type`);
    if (resourceType !== "experiment_run") throw new AdapterResponseShapeError(`$.items[${index}].resource_type`, "experiment_run");
    const action = asOneOf(entry.action, FEATURE_FLAG_LIFECYCLE_ACTIONS, `$.items[${index}].action`);
    return {
      id: asString(entry.id, `$.items[${index}].id`),
      timestampIso: new Date(asNumber(entry.created_at_millis, `$.items[${index}].created_at_millis`)).toISOString(),
      kind: "lifecycle",
      action,
      resourceId: asString(entry.resource_id, `$.items[${index}].resource_id`),
      experimentId: filters.experimentId ?? null,
      actorType: asString(entry.actor_type, `$.items[${index}].actor_type`),
      actor: actorId,
      source: asString(entry.source, `$.items[${index}].source`),
      message: LIFECYCLE_MESSAGES.get(action) ?? throwNoLifecycleMessage(action),
    };
  }).filter((entry) => filters.action === undefined || entry.action === filters.action)
    .sort((left, right) => stringCompare(right.timestampIso, left.timestampIso));
}

function throwNoLifecycleMessage(action: FeatureFlagLifecycleAction): never {
  throw new HexclaveAssertionError(`No lifecycle activity message exists for ${action}`);
}

export async function getLastExposures(adminApp: object): Promise<Map<string, string>> {
  const body = asRecord(await requestJson(adminApp, "/internal/feature-flags/last-exposures", { method: "GET" }), "$");
  return new Map(Object.entries(asRecord(body.last_exposure_iso_by_flag_id, "$.last_exposure_iso_by_flag_id")).map(([flagId, value]) => [flagId, asString(value, `$.last_exposure_iso_by_flag_id.${flagId}`)]));
}

export type FlagEvaluationContext = { userId: string | null, email: string | null, teamId: string | null, environment: string | null, customAttributes: Map<string, string> };
export type FlagEvaluationResult = { variantId: string, jsonValue: string, reason: string, matchedRuleId: string | null };

export async function evaluateFlagWithoutExposure(adminApp: object, flagKey: string, context: FlagEvaluationContext): Promise<FlagEvaluationResult> {
  const body = asRecord(await requestJson(adminApp, "/internal/feature-flags/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flag_keys: [flagKey],
      user_id: context.userId ?? undefined,
      team_id: context.teamId ?? undefined,
      user: context.email == null ? undefined : { email: context.email },
      context: { environment: context.environment, ...Object.fromEntries(context.customAttributes) },
    }),
  }), "$");
  const result = asRecord(asRecord(body.results, "$.results")[flagKey], `$.results.${flagKey}`);
  return {
    variantId: asStringOrNull(result.variant_key, `$.results.${flagKey}.variant_key`) ?? "",
    jsonValue: JSON.stringify(result.value),
    reason: asString(result.reason, `$.results.${flagKey}.reason`),
    matchedRuleId: asStringOrNull(result.rule_id, `$.results.${flagKey}.rule_id`),
  };
}
