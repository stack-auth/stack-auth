import type { FeatureFlagsConfig } from "../../feature-flags/types";
import type { Json } from "../../utils/json";

export type FeatureFlagEvaluationReason = string;

export type FeatureFlagEvaluateRequest = {
  flag_keys: string[],
  fallbacks?: Record<string, Json>,
  distinct_id?: string,
  user_id?: string,
  team_id?: string,
  user?: Record<string, Json>,
  team?: Record<string, Json>,
  context?: Record<string, Json>,
  segments?: Record<string, true>,
};

export type FeatureFlagEvaluateResult<T extends Json = Json> = {
  flag_key: string,
  value: T,
  variant_key: string | null,
  reason: FeatureFlagEvaluationReason,
  rule_id: string | null,
  config_version: string,
  experiment_id: string | null,
  experiment_run_id: string | null,
  exposure_token: string | null,
  /** SDK-local metadata; public evaluate responses omit this field. */
  is_stale?: boolean,
};

export type FeatureFlagEvaluateResponse<T extends Json = Json> = {
  results: Record<string, FeatureFlagEvaluateResult<T>>,
};

export type FeatureFlagBootstrapResponse = {
  config: FeatureFlagsConfig,
  flag_ids_by_key: Record<string, string>,
  config_version: string,
};

export type FeatureFlagExposureRequest = {
  event_id: string,
  exposure_token: string,
  exposed_at_ms: number,
};

export type FeatureFlagExposureBatchRequest = {
  exposures: FeatureFlagExposureRequest[],
};

export type FeatureFlagExperimentRunStatus = "draft" | "scheduled" | "running" | "paused" | "completed";

export type FeatureFlagExperimentRun = {
  id: string,
  experiment_id: string,
  branch_id: string,
  status: FeatureFlagExperimentRunStatus,
  config_version: string,
  created_at_millis: number,
  started_at_millis: number | null,
  paused_at_millis: number | null,
  completed_at_millis: number | null,
};

export type FeatureFlagExperimentMetricResult = {
  metric_id: string,
  variant_key: string,
  subjects: number,
  value: number | null,
  credible_interval: { lower: number, upper: number } | null,
  probability_to_be_best: number | null,
};

export type FeatureFlagExperimentResults = {
  run_id: string,
  status: FeatureFlagExperimentRunStatus,
  sample_ratio_mismatch: boolean,
  winner_variant_key: string | null,
  metrics: FeatureFlagExperimentMetricResult[],
};

export type FeatureFlagActivityItem = {
  id: string,
  action: string,
  actor_id: string | null,
  created_at_millis: number,
  flag_id: string | null,
  experiment_id: string | null,
  experiment_run_id: string | null,
  metadata: Json,
};

export type FeatureFlagActivityResponse = {
  items: FeatureFlagActivityItem[],
  next_cursor: string | null,
};
