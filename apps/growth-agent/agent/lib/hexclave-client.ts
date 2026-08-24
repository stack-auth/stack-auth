import type { GrowthActionItemInput, GrowthCategoryScore, GrowthDocumentInput, GrowthFinding, GrowthInterviewQuestion, GrowthNote, GrowthProjectRef, JsonValue, OpaqueJsonObject } from "#lib/types.ts";

/**
 * Typed fetch wrapper for the Hexclave backend's internal/growth-agent API.
 * One function per backend endpoint; bodies are snake_case to match the wire
 * format. All calls authenticate with the shared service secret
 * (HEXCLAVE_GROWTH_AGENT_API_SECRET) as a bearer token.
 *
 * Input types mirror the backend route body schemas exactly — in particular
 * every body carries project_id/branch_id, because the machine-secret auth is
 * scoped to a tenancy on each request. Response bodies stay `unknown` on
 * purpose: the backend declares them as `yupMixed` (free-form JSON meant to be
 * relayed to the model, not interpreted here), so `unknown` is the honest
 * type and callers that do need a field must narrow explicitly.
 */

function getRequiredEnv(name: "HEXCLAVE_GROWTH_BACKEND_URL" | "HEXCLAVE_GROWTH_AGENT_API_SECRET"): string {
  const value = process.env[name];
  if (value == null || value.length === 0) {
    throw new Error(`${name} is not set; the growth agent cannot reach the Hexclave backend without it`);
  }
  return value;
}

async function callBackend(method: "GET" | "POST", path: string, options: {
  // `unknown` rather than a strict JSON type: bodies are built from typed
  // inputs with optional fields, and JSON.stringify drops `undefined` values,
  // which a strict JsonValue object type would reject at the spread sites.
  readonly body?: unknown,
  readonly query?: Readonly<Record<string, string>>,
} = {}): Promise<unknown> {
  const baseUrl = getRequiredEnv("HEXCLAVE_GROWTH_BACKEND_URL");
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/latest/internal/growth-agent/${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    method,
    headers: {
      "authorization": `Bearer ${getRequiredEnv("HEXCLAVE_GROWTH_AGENT_API_SECRET")}`,
      ...options.body === undefined ? {} : { "content-type": "application/json" },
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new Error(`Hexclave backend request failed: ${method} ${url.pathname} -> ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}

// Path segments interpolated into backend URLs are ids we received from the
// backend itself, but encode them anyway so a malformed id fails as a 404
// instead of escaping into a different route.
function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function sqlQuery(input: GrowthProjectRef & {
  readonly query: string,
  readonly max_rows?: number,
}): Promise<unknown> {
  return await callBackend("POST", "sql-query", { body: input });
}

export async function getMetrics(projectRef: GrowthProjectRef): Promise<unknown> {
  return await callBackend("GET", "metrics", { query: { ...projectRef } });
}

/**
 * Fetches the full metric-system context: the stored metric catalog (what lives in the ClickHouse
 * growth_daily_metrics / growth_daily_ad_metrics tables), ready-to-run SQL templates for
 * on-the-fly metrics, the not-measurable list, the queryable-table list, markdown correlation
 * rules, and this tenancy's data freshness. Response shape: { stored_metrics, on_the_fly_metrics,
 * not_possible, queryable_tables, correlation_rules, freshness }.
 */
export async function getMetricsContext(projectRef: GrowthProjectRef): Promise<unknown> {
  return await callBackend("GET", "metrics-context", { query: { ...projectRef } });
}

export async function getProjectContext(projectRef: GrowthProjectRef): Promise<unknown> {
  return await callBackend("GET", "project-context", { query: { ...projectRef } });
}

export async function getContextBundle(input: GrowthProjectRef & {
  /** Scopes the bundle's run-derived data (findings, interview answers) to one run. */
  readonly run_id?: string,
}): Promise<unknown> {
  return await callBackend("GET", "context-bundle", {
    query: {
      project_id: input.project_id,
      branch_id: input.branch_id,
      ...input.run_id === undefined ? {} : { run_id: input.run_id },
    },
  });
}

// ---------------------------------------------------------------------------
// Run phase lifecycle
// ---------------------------------------------------------------------------

type PhaseLifecycleInput = GrowthProjectRef & {
  readonly run_id: string,
  readonly phase_key: string,
  readonly attempt: number,
};

async function callPhaseLifecycle(action: "start" | "heartbeat" | "complete" | "fail", input: PhaseLifecycleInput, extraBody: Readonly<Record<string, JsonValue>> = {}): Promise<unknown> {
  // Pick fields explicitly instead of rest-spreading: callers often pass
  // wider run-request objects (e.g. with `date`), and those
  // extras must not leak into the lifecycle endpoint bodies.
  return await callBackend("POST", `runs/${pathSegment(input.run_id)}/phases/${pathSegment(input.phase_key)}/${action}`, {
    body: { project_id: input.project_id, branch_id: input.branch_id, attempt: input.attempt, ...extraBody },
  });
}

export async function phaseStart(input: PhaseLifecycleInput): Promise<unknown> {
  return await callPhaseLifecycle("start", input);
}

export async function phaseHeartbeat(input: PhaseLifecycleInput): Promise<unknown> {
  return await callPhaseLifecycle("heartbeat", input);
}

export async function phaseComplete(input: PhaseLifecycleInput): Promise<unknown> {
  return await callPhaseLifecycle("complete", input);
}

export async function phaseFail(input: PhaseLifecycleInput & {
  readonly error_message: string,
}): Promise<unknown> {
  const { error_message, ...lifecycleInput } = input;
  return await callPhaseLifecycle("fail", lifecycleInput, { error_message });
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export async function saveFindings(input: GrowthProjectRef & {
  readonly run_id?: string,
  readonly source: string,
  readonly findings: readonly GrowthFinding[],
}): Promise<unknown> {
  return await callBackend("POST", "findings", { body: input });
}

/**
 * Notes are the trend/pattern lane of the workspace, next to findings: a finding is a point-in-time
 * insight, a note is "this has been moving this way for N weeks". The finding `kind` that marks a
 * note is pinned server-side, so there is nothing here that can put a note in the wrong lane.
 */
export async function saveNotes(input: GrowthProjectRef & {
  readonly run_id?: string,
  readonly source: string,
  readonly notes: readonly GrowthNote[],
}): Promise<unknown> {
  return await callBackend("POST", "notes", { body: input });
}

/**
 * Scores the whole growth journey at once. The backend rejects a partial set, so a partial write
 * would leave the customer looking at
 * "Not scored" while the agent believed it had scored the project.
 */
export async function saveCategoryScores(input: GrowthProjectRef & {
  readonly scores: readonly GrowthCategoryScore[],
}): Promise<unknown> {
  return await callBackend("POST", "category-scores", { body: input });
}

export async function saveArtifact(input: GrowthProjectRef & {
  readonly run_id?: string,
  readonly kind: string,
  readonly title: string,
  readonly content: string,
  readonly metadata?: OpaqueJsonObject,
}): Promise<unknown> {
  return await callBackend("POST", "artifacts", { body: input });
}

export async function saveInterviewQuestions(input: GrowthProjectRef & {
  readonly run_id: string,
  readonly questions: readonly GrowthInterviewQuestion[],
}): Promise<unknown> {
  return await callBackend("POST", "interview-questions", { body: input });
}

/**
 * Appends ONE adaptive follow-up question to the interview plan (backend append mode of the
 * interview-questions route). Unlike saveInterviewQuestions this works mid-interview (pending or
 * active) and never touches existing rows. The response carries the new question_id / order_index.
 */
export async function appendInterviewQuestion(input: GrowthProjectRef & {
  readonly run_id: string,
  readonly question: GrowthInterviewQuestion,
}): Promise<unknown> {
  return await callBackend("POST", "interview-questions", {
    body: {
      project_id: input.project_id,
      branch_id: input.branch_id,
      run_id: input.run_id,
      append: true,
      questions: [input.question],
    },
  });
}

export async function saveReport(input: GrowthProjectRef & {
  readonly run_id: string,
  readonly title?: string,
  readonly summary: string,
  readonly content_md: string,
  readonly document?: GrowthDocumentInput,
  readonly sections?: JsonValue,
  readonly action_items: readonly GrowthActionItemInput[],
}): Promise<unknown> {
  return await callBackend("POST", "report", { body: input });
}

export async function saveBrief(input: GrowthProjectRef & {
  readonly date: string,
  readonly summary: string,
  readonly content_md: string,
  readonly document?: GrowthDocumentInput,
  readonly data?: OpaqueJsonObject,
}): Promise<unknown> {
  return await callBackend("POST", "briefs", { body: input });
}

export async function createActionItem(input: GrowthProjectRef & GrowthActionItemInput & {
  readonly brief_id?: string,
}): Promise<unknown> {
  return await callBackend("POST", "action-items", { body: input });
}

export async function completeInterview(input: GrowthProjectRef & {
  readonly run_id: string,
}): Promise<unknown> {
  return await callBackend("POST", "interview/complete", { body: input });
}

// ---------------------------------------------------------------------------
// Workflow authoring
// ---------------------------------------------------------------------------

/**
 * Fetches the one-stop authoring context for growth workflows: the exact TypeScript
 * type contract (dts) the dashboard's workflow editor uses, the authoring guide,
 * growth-specific policy rules, the tenancy's existing growth-workflow ids, and the
 * platform event types workflows may subscribe to. Response shape:
 * { dts, guide, growth_rules, existing_growth_workflow_ids, platform_events }.
 */
export async function getWorkflowAuthoringContext(projectRef: GrowthProjectRef): Promise<unknown> {
  return await callBackend("GET", "workflow-authoring-context", { query: { ...projectRef } });
}

/**
 * Validates a candidate growth workflow's source. Never throws on validation
 * failure — every outcome (including the backend's rate limit) is a structured
 * 200 body { valid, error, manifest, workflow_id_available, warnings } meant to
 * be fed back to the model verbatim.
 */
export async function validateWorkflowSource(input: GrowthProjectRef & {
  readonly workflow_id: string,
  readonly source: string,
}): Promise<unknown> {
  return await callBackend("POST", "validate-workflow-source", { body: input });
}
