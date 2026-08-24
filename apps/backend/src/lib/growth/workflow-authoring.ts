import { compileAndExtractWorkflowManifest } from "@/lib/workflows/compile";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { workflowsSkillSection } from "@hexclave/shared/dist/ai/unified-prompts/skill-site-prompt-parts/workflows-skill";
import {
  WORKFLOW_CUSTOM_EVENT_PREFIX,
  WORKFLOW_ID_REGEX,
  workflowPlatformEventTypes,
  type WorkflowManifestJson,
} from "@hexclave/shared/dist/interface/workflows";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";
import { deindent } from "@hexclave/shared/dist/utils/strings";

/**
 * Authoring-side validation for agent-proposed growth workflows. The growth agent writes ordinary
 * customer workflows (deployed via the workflows app on activation of an action item); this module
 * is the machine-facing pre-flight: it dry-compiles the source exactly like a dashboard save would
 * (lib/workflows/compile.tsx, persisting nothing) so the agent gets the same rejection the deploy
 * would produce — at proposal time instead of activation time.
 */

/** Every growth-authored workflow id must carry this prefix so customers can immediately tell
 * agent-authored workflows apart from their own in the dashboard listing. */
export const GROWTH_WORKFLOW_ID_PREFIX = "growth-";

/** Wire prefix of the one-shot activation events the growth app emits when an action item with an
 * attached workflow is activated (customEvent("growth.action.<slug>") → "custom.growth.action.<slug>"). */
export const GROWTH_ACTION_EVENT_NAME_PREFIX = "growth.action.";
const GROWTH_ACTION_EVENT_WIRE_PREFIX = `${WORKFLOW_CUSTOM_EVENT_PREFIX}${GROWTH_ACTION_EVENT_NAME_PREFIX}`;

/**
 * The slug used in the activation event name for an action item's workflow. Derived purely from
 * the stored workflowId (strip the naming-convention prefix) so the activation emitter — a later
 * part of the migration — can recompute it from the GrowthActionItem row alone, without storing a
 * separate slug column that could drift from the id.
 */
export function getGrowthActionEventSlug(workflowId: string): string {
  for (const prefix of ["growth-action-", "growth-task-", GROWTH_WORKFLOW_ID_PREFIX]) {
    if (workflowId.startsWith(prefix) && workflowId.length > prefix.length) {
      return workflowId.slice(prefix.length);
    }
  }
  return workflowId;
}

export type GrowthWorkflowSpecValidationResult = {
  valid: boolean,
  /** Human/agent-readable rejection reason; null when valid. */
  error: string | null,
  /** The dry-compile manifest; null when compilation was not reached or failed. */
  manifest: WorkflowManifestJson | null,
  /** Whether no WorkflowDefinition with this id exists yet in the tenancy. */
  workflowIdAvailable: boolean,
};

/**
 * Validates an agent-proposed workflow spec without persisting anything. Mirrors the checks a real
 * deploy (syncWorkflowSource) would run, plus growth-specific policy: the id must be
 * growth-prefixed and unused, and any activation-event trigger must reference the item's own slug
 * (a workflow listening on ANOTHER item's activation event would fire when an unrelated
 * recommendation is activated — always an authoring bug).
 */
export async function validateGrowthWorkflowSpec(options: {
  tenancy: Tenancy,
  workflowId: string,
  source: string,
  /** The activation-event slug this item's workflow may subscribe to; see getGrowthActionEventSlug. */
  expectedActionEventSlug: string,
}): Promise<GrowthWorkflowSpecValidationResult> {
  const { tenancy, workflowId, source } = options;
  if (!WORKFLOW_ID_REGEX.test(workflowId)) {
    return { valid: false, error: "Workflow ids must be 1-64 chars of lowercase letters, digits, and dashes.", manifest: null, workflowIdAvailable: false };
  }
  if (!workflowId.startsWith(GROWTH_WORKFLOW_ID_PREFIX) || workflowId.length <= GROWTH_WORKFLOW_ID_PREFIX.length) {
    return { valid: false, error: `Growth-authored workflow ids must start with "${GROWTH_WORKFLOW_ID_PREFIX}" (prefer "growth-action-<slug>" for one-shot actions and "growth-task-<slug>" for recurring tasks).`, manifest: null, workflowIdAvailable: false };
  }
  const existing = await globalPrismaClient.workflowDefinition.findUnique({
    where: { tenancyId_workflowId: { tenancyId: tenancy.id, workflowId } },
    select: { workflowId: true },
  });
  const workflowIdAvailable = existing == null;
  if (!workflowIdAvailable) {
    return { valid: false, error: `A workflow with id "${workflowId}" already exists in this project. Pick an unused id.`, manifest: null, workflowIdAvailable };
  }
  const compiled = await compileAndExtractWorkflowManifest(source, workflowId);
  if (compiled.status === "error") {
    return { valid: false, error: compiled.error, manifest: null, workflowIdAvailable };
  }
  const manifest = compiled.data.manifest;
  for (const trigger of manifest.triggers) {
    if (trigger.type !== "event" || !trigger.event_type.startsWith(GROWTH_ACTION_EVENT_WIRE_PREFIX)) continue;
    const expectedEventType = `${GROWTH_ACTION_EVENT_WIRE_PREFIX}${options.expectedActionEventSlug}`;
    if (trigger.event_type !== expectedEventType) {
      return {
        valid: false,
        error: `The workflow subscribes to activation event "${trigger.event_type}", but this action item's activation event is "${expectedEventType}". A workflow may only react to its own item's activation.`,
        manifest,
        workflowIdAvailable,
      };
    }
  }
  return { valid: true, error: null, manifest, workflowIdAvailable };
}

// ─── Source warnings (best-effort, never blocking) ─────────────────────────

// Common secret-key shapes (Stripe-style sk_/pk_/rk_/whsec_, GitHub ghp_, Slack xox?-, AWS AKIA,
// JWTs). Purely heuristic: false negatives are fine (the dashboard shows the full source anyway),
// false positives just add a warning line to the review dialog.
const SECRET_LIKE_REGEXES = [
  /\b(?:sk|pk|rk|whsec)_[A-Za-z0-9]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

// Long unbroken base64/hex-ish literals with high character diversity. Entropy threshold chosen so
// prose, identifiers, and URLs stay below it while random key material lands well above.
const HIGH_ENTROPY_CANDIDATE_REGEX = /["'`]([A-Za-z0-9+/=_-]{32,})["'`]/g;
const HIGH_ENTROPY_BITS_PER_CHAR = 4.5;

function shannonEntropyBitsPerChar(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const URL_DOMAIN_REGEX = /\bhttps?:\/\/([a-zA-Z0-9.-]+)/g;

function truncateForWarning(value: string): string {
  // Never echo a full potential secret back; the prefix is enough to locate it in the source.
  return value.length <= 12 ? value : `${value.slice(0, 12)}…`;
}

/**
 * Best-effort, non-blocking scan of workflow source for things a human should see in the
 * activation/review dialog: literals that look like secrets (workflow source is displayed in the
 * customer dashboard, so a secret in source is effectively published to every project admin) and
 * the external domains the workflow calls out to. Pure function; results are display strings.
 */
export function scanWorkflowSourceWarnings(source: string): string[] {
  const warnings: string[] = [];
  const flaggedLiterals = new Set<string>();
  for (const regex of SECRET_LIKE_REGEXES) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source)) !== null) {
      flaggedLiterals.add(match[0]);
    }
  }
  HIGH_ENTROPY_CANDIDATE_REGEX.lastIndex = 0;
  let entropyMatch;
  while ((entropyMatch = HIGH_ENTROPY_CANDIDATE_REGEX.exec(source)) !== null) {
    const literal = entropyMatch[1];
    if ([...flaggedLiterals].some((flagged) => flagged.includes(literal) || literal.includes(flagged))) continue;
    if (shannonEntropyBitsPerChar(literal) >= HIGH_ENTROPY_BITS_PER_CHAR) {
      flaggedLiterals.add(literal);
    }
  }
  for (const literal of flaggedLiterals) {
    warnings.push(`Source contains a literal that looks like a secret (${truncateForWarning(literal)}). Workflow source is visible in the customer dashboard — never embed secrets in it.`);
  }
  const domains = new Set<string>();
  URL_DOMAIN_REGEX.lastIndex = 0;
  let urlMatch;
  while ((urlMatch = URL_DOMAIN_REGEX.exec(source)) !== null) {
    domains.add(urlMatch[1].toLowerCase());
  }
  for (const domain of [...domains].sort()) {
    warnings.push(`Source references external domain: ${domain}`);
  }
  return warnings;
}

// ─── Validation rate limit ─────────────────────────────────────────────────

export const GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT = 20;
export const GROWTH_WORKFLOW_VALIDATION_RATE_WINDOW_MS = 60_000;

// In-memory sliding window per project. Each validation call runs a real esbuild bundle plus a
// manifest-mode sandbox execution — cheap enough for interactive authoring, expensive enough that
// a looping agent must not be able to hammer it. In-memory (not shared across instances) is fine:
// the limit is a cost brake, not a security boundary, and per-instance 20/min still bounds total
// sandbox load linearly in instance count.
const validationCallTimestampsByProject = new Map<string, number[]>();

export function consumeGrowthWorkflowValidationRateLimit(projectId: string, nowMs: number = performance.now()): boolean {
  const cutoff = nowMs - GROWTH_WORKFLOW_VALIDATION_RATE_WINDOW_MS;
  const recent = (validationCallTimestampsByProject.get(projectId) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= GROWTH_WORKFLOW_VALIDATION_RATE_LIMIT) {
    validationCallTimestampsByProject.set(projectId, recent);
    return false;
  }
  recent.push(nowMs);
  validationCallTimestampsByProject.set(projectId, recent);
  return true;
}

// ─── Authoring context (served to the agent) ───────────────────────────────

const GUIDE_AUTHORING_SECTION_START = "## Authoring: write the code, hand it to the user";
const GUIDE_AUTHORING_SECTION_END = "## Writing a workflow";

/**
 * The workflows skill guide with the human deployment section ("paste it into the dashboard")
 * swapped for the growth deployment model: the agent attaches source to an action item and the
 * growth app deploys it on activation. String surgery over a fork of the guide so the rest of the
 * skill text can never drift between the two consumers.
 */
export function getGrowthWorkflowAuthoringGuide(): string {
  const startIndex = workflowsSkillSection.indexOf(GUIDE_AUTHORING_SECTION_START);
  const endIndex = workflowsSkillSection.indexOf(GUIDE_AUTHORING_SECTION_END);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new HexclaveAssertionError("workflowsSkillSection no longer contains the expected authoring section markers — update getGrowthWorkflowAuthoringGuide alongside the skill text.", { startIndex, endIndex });
  }
  const replacement = deindent`
    ## Authoring: attach the workflow to an action item

    You are the growth agent: do NOT tell anyone to paste code into the dashboard. Instead, attach
    the complete workflow source (plus an id, an explanation, and a rollback note) to the action
    item you are proposing. When the customer activates the item, the growth app deploys the
    workflow as an ordinary customer-editable workflow under the id you chose. Validate the source
    with the validate-workflow-source endpoint before attaching it.

  `;
  return workflowsSkillSection.slice(0, startIndex) + replacement + workflowsSkillSection.slice(endIndex);
}

export function getGrowthWorkflowRules(): string {
  return deindent`
    # Growth workflow rules

    ## Naming
    - Workflow ids must match ${WORKFLOW_ID_REGEX.toString()} and start with "growth-".
    - Use "growth-action-<slug>" for one-shot workflows that run when the customer activates the
      action item, and "growth-task-<slug>" for recurring/reactive automations.
    - The id is permanent and shown to the customer in their workflows list — pick something a
      human can read.

    ## Trigger recipes
    1. One-shot on activation: trigger on customEvent("growth.action.<slug>") where <slug> is your
       workflow id without its "growth-action-"/"growth-task-" prefix. The activation event payload
       is { action_item_id: string, title: string, activated_at_millis: number }. Set
       runKey: () => "activation" and onConflict: "skip" so re-activations can never double-run.
    2. Recurring: schedule("<cron>", { timezone: "UTC" }) with a coarse cron (hourly or slower) —
       growth automations are analytics-paced, not realtime.
    3. Reactive: trigger on platform events (e.g. "user.created") and derive runKey from the entity
       id in the payload (e.g. runKey: (event) => "user:" + event.data.id) so each entity gets at
       most one concurrent run.

    ## Hard rules
    - NEVER place secrets, API keys, or tokens in workflow source. The source is displayed verbatim
      in the customer dashboard; anything embedded in it is visible to every project admin.
    - The source must be self-contained (only "@hexclave/workflows" and "date-fns" imports) and the
      id passed to workflow() must equal the workflow id you attach.
    - A workflow may only subscribe to its OWN item's activation event, never another item's.
  `;
}

export async function listExistingGrowthWorkflowIds(tenancy: Tenancy): Promise<string[]> {
  const definitions = await globalPrismaClient.workflowDefinition.findMany({
    where: { tenancyId: tenancy.id, workflowId: { startsWith: GROWTH_WORKFLOW_ID_PREFIX } },
    orderBy: { workflowId: "asc" },
    select: { workflowId: true },
  });
  return definitions.map((definition) => definition.workflowId);
}

export function getWorkflowPlatformEventTypes(): string[] {
  return [...workflowPlatformEventTypes];
}
