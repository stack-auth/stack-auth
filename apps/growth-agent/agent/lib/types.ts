
/**
 * Wire types shared between the Hexclave backend and this agent. Bodies are
 * snake_case on the wire to match the backend's internal/growth-agent API
 * surface; keep these in sync with the backend route schemas (task 6B tightens
 * them once those routes exist end-to-end).
 */

/** JSON-serializable value, used for payloads we pass through without interpreting. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * An object we forward to the backend without interpreting its contents — the `data`, `metadata`,
 * and `payload` bags.
 *
 * Values are `unknown` rather than `JsonValue` on purpose. These are populated from a model's tool
 * call, so they are already-parsed JSON by construction, and the schemas that produce them
 * (`agent/lib/json-payload.ts`) deliberately keep the value type opaque so the emitted JSON Schema
 * stays free of the recursive `$ref` that some providers reject outright. A structural `JsonValue`
 * cannot be expressed without that recursion, so the honest type for "an object whose shape is not
 * ours to know" is this one. Everything here is JSON.stringify'd on the way out.
 */
export type OpaqueJsonObject = Readonly<Record<string, unknown>>;

export type GrowthDocumentInput = {
  readonly format: "growth-mdx-v1",
  readonly source_mdx: string,
  readonly data: readonly OpaqueJsonObject[],
};

/** Identifies which customer project + branch a run operates on. Present on every run request. */
export type GrowthProjectRef = {
  readonly project_id: string,
  readonly branch_id: string,
};

/**
 * The run-scoped `grt_` token the backend mints per dispatch, carried on every inbound run body.
 *
 * Optional on purpose, and every consumer must tolerate its absence: the backend chunk that starts
 * sending it can deploy after this agent, and the correct behaviour without it is a Meta ads
 * connection that reports itself unavailable — never a failed dispatch. It travels in the BODY
 * rather than a header because the `authorization` header already carries the shared service secret
 * that authenticates the backend->agent hop; this token authenticates the SESSION to the backend,
 * which is a different question with a different lifetime.
 */
export type GrowthAgentTokenRef = {
  readonly agent_token?: string,
};

/** Inbound body of POST /runs/analysis-phase (backend -> agent). */
export type AnalysisPhaseRunRequest = GrowthProjectRef & GrowthAgentTokenRef & {
  readonly run_id: string,
  readonly phase_key: string,
  readonly attempt: number,
};

/**
 * Inbound body of POST /runs/daily-brief (backend -> agent). Briefs have no
 * phase lifecycle: the backend pre-creates the brief row (its "generating"
 * status is the day lock) and the agent's only obligation is to fill it via
 * the briefs write endpoint, keyed by project/branch/date.
 */
export type DailyBriefRunRequest = GrowthProjectRef & GrowthAgentTokenRef & {
  readonly brief_id: string,
  /** ISO date (YYYY-MM-DD, UTC) the brief covers. */
  readonly date: string,
};

export type GrowthFindingKind = string;

export type GrowthCategory = "product" | "reach" | "conversion" | "retention" | "revenue";

export type GrowthFinding = {
  readonly kind: GrowthFindingKind,
  readonly category: GrowthCategory,
  readonly tags: readonly string[],
  readonly title: string,
  readonly body: string,
  readonly data?: OpaqueJsonObject,
  readonly document?: GrowthDocumentInput,
};

/**
 * A note is a finding whose `kind` the backend pins to "note" — it is never sent from here, which is
 * why this type has no `kind` field. See the /notes route: the kind is what the workspace's
 * findings-vs-notes lane split keys on, so it stays server-owned.
 */
export type GrowthNote = {
  readonly category: GrowthCategory,
  readonly tags: readonly string[],
  readonly title: string,
  readonly body: string,
  readonly data?: OpaqueJsonObject,
  readonly document?: GrowthDocumentInput,
};

export type GrowthCategoryScore = {
  readonly category: GrowthCategory,
  readonly score: number,
};

export type GrowthInterviewQuestionOption = {
  readonly id: string,
  readonly label: string,
  readonly description?: string,
};

export type GrowthInterviewQuestion = {
  readonly question_key: string,
  readonly prompt: string,
  readonly kind: string,
  readonly options: readonly GrowthInterviewQuestionOption[],
  readonly allow_skip?: boolean,
  readonly origin?: string,
};

/**
 * A metric the backend should watch after an action item is executed, matching
 * the backend's `watched_metrics` body schema ({ metric_id, window_days }
 * objects, not bare metric-id strings).
 */
export type GrowthWatchedMetricInput = {
  readonly metric_id: string,
  readonly window_days: number,
};

/**
 * An agent-authored workflow attached to an action item, matching the backend's
 * nested `workflow` body schema on the report/action-items routes. All-or-nothing:
 * once the object is present every field is required (the backend enforces the
 * same shape). Deployment happens when the customer activates the item, never at
 * write time.
 */
export type GrowthWorkflowSpecInput = {
  readonly workflow_id: string,
  readonly source: string,
  readonly explanation: string,
  readonly rollback_note: string,
};

export type GrowthActionItemInput = {
  readonly type_id: string,
  readonly category: GrowthCategory,
  readonly tags: readonly string[],
  readonly title: string,
  readonly description: string,
  readonly document?: GrowthDocumentInput,
  readonly payload?: OpaqueJsonObject,
  readonly watched_metrics?: readonly GrowthWatchedMetricInput[],
  readonly workflow?: GrowthWorkflowSpecInput,
};
