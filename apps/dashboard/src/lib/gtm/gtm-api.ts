import { sendInternalAdminRequest, sendInternalUserRequest } from "@/lib/hexclave-app-internals";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { z } from "zod";
import {
  GTM_ACTION_STATUSES,
  GTM_ACTION_TYPES,
  GTM_DOMAINS,
  GTM_NOTE_CATEGORIES,
  GTM_NOTE_SOURCES,
  GTM_VERDICTS,
  type GtmAction,
  type GtmInsight,
  type GtmNote,
  type GtmTimeline,
} from "./gtm-types";

const timelineEntrySchema = z.object({
  label: z.string(),
  title: z.string(),
  body: z.string(),
  date_millis: z.number(),
});
// The wire format keeps `null` (never curated) apart from `[]` (emptied on purpose) rather than collapsing
// both; the page renders them the same, but the stored rows record which one happened.
const timelineSchema = z.array(timelineEntrySchema).nullable();

const insightSchema = z.object({
  id: z.string().uuid(), created_at_millis: z.number(), updated_at_millis: z.number(), domain: z.enum(GTM_DOMAINS), title: z.string(), body: z.string(),
  impact_score: z.number(), times_seen: z.number(), last_seen_at_millis: z.number(), timeline_entries: timelineSchema,
});
const actionSchema = z.object({
  id: z.string().uuid(), created_at_millis: z.number(), updated_at_millis: z.number(), domain: z.enum(GTM_DOMAINS), type: z.enum(GTM_ACTION_TYPES),
  status: z.enum(GTM_ACTION_STATUSES), title: z.string(), summary: z.string(), verdict: z.enum(GTM_VERDICTS).nullable(),
  retrospective_text: z.string().nullable(), expires_at_millis: z.number(), executed_at_millis: z.number().nullable(), timeline_entries: timelineSchema,
});
const noteSchema = z.object({
  id: z.string().uuid(), created_at_millis: z.number(), updated_at_millis: z.number(), domain: z.enum(GTM_DOMAINS), category: z.enum(GTM_NOTE_CATEGORIES),
  title: z.string().nullable(), body: z.string(), source: z.enum(GTM_NOTE_SOURCES), last_confirmed_at_millis: z.number(),
});
const onboardingDetailsSchema = z.object({
  domain: z.string().nullable(),
  phone: z.string(),
  notes: z.string(),
});
const onboardingSchema = z.discriminatedUnion("completed", [
  z.object({
    completed: z.literal(false),
    completed_at_millis: z.null(),
    details: z.null(),
  }),
  z.object({
    completed: z.literal(true),
    completed_at_millis: z.number(),
    details: onboardingDetailsSchema,
  }),
]);
const onboardingStatusSchema = z.discriminatedUnion("completed", [
  z.object({
    completed: z.literal(false),
    completed_at_millis: z.null(),
  }),
  z.object({
    completed: z.literal(true),
    completed_at_millis: z.number(),
  }),
]);
const onboardedProjectSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  completed_at_millis: z.number(),
  details: onboardingDetailsSchema,
});

export type GtmInsightDraft = Omit<GtmInsight, "id" | "createdAtMillis" | "updatedAtMillis" | "lastSeenAtMillis">;
export type GtmActionDraft = Omit<GtmAction, "id" | "createdAtMillis" | "updatedAtMillis">;
export type GtmNoteDraft =
  & Omit<GtmNote, "id" | "createdAtMillis" | "updatedAtMillis" | "lastConfirmedAtMillis" | "title">
  & { title: string };

export class GtmApiError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = "GtmApiError";
  }
}

export type GtmOnboardingStatus = z.infer<typeof onboardingSchema>;
export type GtmOnboardingCompletionStatus = z.infer<typeof onboardingStatusSchema>;
export type GtmCompletedOnboardingStatus = Extract<GtmOnboardingStatus, { completed: true }>;
export type GtmCompletedOnboardingCompletionStatus = Extract<GtmOnboardingCompletionStatus, { completed: true }>;
export type GtmOnboardingDetails = z.infer<typeof onboardingDetailsSchema>;
export type GtmOnboardedProject = {
  id: string,
  displayName: string,
  completedAtMillis: number,
  details: GtmOnboardingDetails,
};

async function requestJson(app: object, path: string, init: RequestInit = {}, access: "user" | "admin" = "user"): Promise<unknown> {
  const sendRequest = access === "admin" ? sendInternalAdminRequest : sendInternalUserRequest;
  const response = await sendRequest(app, `/internal/gtm${path}`, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  const text = await response.text();
  if (!response.ok) {
    let message = `GTM request failed with status ${response.status}`;
    try {
      const body = z.object({ error: z.string().optional() }).passthrough().parse(JSON.parse(text));
      message = body.error ?? message;
    } catch {
      // A non-JSON proxy response has no safe message to expose; keep the status fallback.
    }
    throw new GtmApiError(response.status, message);
  }
  return text.length === 0 ? {} : JSON.parse(text);
}

function mapTimeline(entries: z.infer<typeof timelineSchema>): GtmTimeline {
  return entries == null ? null : entries.map((entry) => ({ label: entry.label, title: entry.title, body: entry.body, dateMillis: entry.date_millis }));
}
function timelineToWire(timeline: GtmTimeline) {
  return timeline == null ? null : timeline.map((entry) => ({ label: entry.label, title: entry.title, body: entry.body, date_millis: entry.dateMillis }));
}

function mapInsight(value: z.infer<typeof insightSchema>): GtmInsight {
  return { id: value.id, createdAtMillis: value.created_at_millis, updatedAtMillis: value.updated_at_millis, domain: value.domain, title: value.title, body: value.body, impactScore: value.impact_score, timesSeen: value.times_seen, lastSeenAtMillis: value.last_seen_at_millis, timeline: mapTimeline(value.timeline_entries) };
}
function mapAction(value: z.infer<typeof actionSchema>): GtmAction {
  return { id: value.id, createdAtMillis: value.created_at_millis, updatedAtMillis: value.updated_at_millis, domain: value.domain, type: value.type, status: value.status, title: value.title, summary: value.summary, verdict: value.verdict, retrospective: value.retrospective_text, expiresAtMillis: value.expires_at_millis, executedAtMillis: value.executed_at_millis, timeline: mapTimeline(value.timeline_entries) };
}
function mapNote(value: z.infer<typeof noteSchema>): GtmNote {
  return { id: value.id, createdAtMillis: value.created_at_millis, updatedAtMillis: value.updated_at_millis, domain: value.domain, category: value.category, title: value.title, body: value.body, source: value.source, lastConfirmedAtMillis: value.last_confirmed_at_millis };
}

function projectQuery(path: string, projectId: string | undefined, cursor: string | null): string {
  const query = new URLSearchParams();
  if (projectId != null) query.set("project_id", projectId);
  if (cursor != null) query.set("cursor", cursor);
  const queryString = query.toString();
  return queryString.length === 0 ? path : `${path}?${queryString}`;
}

async function listAll<T>(app: object, path: string, schema: z.ZodType<T>, projectId: string | undefined, access: "user" | "admin"): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  do {
    const page = z.object({ items: z.array(schema), next_cursor: z.string().nullable() }).parse(await requestJson(app, projectQuery(path, projectId, cursor), {}, access));
    result.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor != null);
  return result;
}

/**
 * Which project's GTM records a read targets, and — just as importantly — which authorization that
 * read is able to present.
 *
 * `own-project` reads a project's own workspace through its owned-project admin app (the same app the
 * onboarding gate uses). That app is constructed with `tokenStore === null`, so it never sends an access
 * token and the admin key is its only authorization; the request therefore has to go out as an admin
 * request, and the project is implied by the key rather than named in a `project_id` query parameter.
 *
 * `managed-project` is the internal GTM admin path: the dashboard's own user session (a platform admin
 * on the internal project) reads another project's records by naming that project explicitly.
 */
export type GtmDatasetTarget =
  | { kind: "own-project" }
  | { kind: "managed-project", projectId: string };

export async function loadGtmDataset(app: object, target: GtmDatasetTarget) {
  const access = target.kind === "own-project" ? "admin" : "user";
  const projectId = target.kind === "managed-project" ? target.projectId : undefined;
  const [insights, actions, notes] = await Promise.all([
    listAll(app, "/insights", insightSchema, projectId, access), listAll(app, "/actions", actionSchema, projectId, access), listAll(app, "/notes", noteSchema, projectId, access),
  ]);
  return { insights: insights.map(mapInsight), actions: actions.map(mapAction), notes: notes.map(mapNote), radar: null };
}

export async function getGtmOnboarding(app: object): Promise<GtmOnboardingStatus> {
  return onboardingSchema.parse(await requestJson(app, "/onboarding/details", {}, "admin"));
}

export async function getGtmOnboardingCompletionStatus(app: object): Promise<GtmOnboardingCompletionStatus> {
  // The project dashboard reads through the owned-project admin app, which has `tokenStore === null` and
  // so never sends an access token — `auth.user` is always null there, whatever the request type. The
  // admin key is the only authorization it can present, so the request has to go out as an admin request
  // (the endpoint accepts admin-without-user precisely for this caller).
  return onboardingStatusSchema.parse(await requestJson(app, "/onboarding", {}, "admin"));
}

export async function completeGtmOnboarding(app: object, input: { domain: string, phone: string, notes: string }): Promise<GtmCompletedOnboardingStatus> {
  const onboarding = onboardingSchema.parse(await requestJson(app, "/onboarding/details", { method: "POST", body: JSON.stringify(input) }, "admin"));
  if (!onboarding.completed) {
    throw new Error("Completing GTM onboarding returned an incomplete onboarding state.");
  }
  return onboarding;
}

/**
 * The initial intake only needs confirmation that the project is onboarded. Keep
 * that success path independent from the editable detail fields, which are read
 * separately when an owner opens GTM settings.
 */
export async function completeGtmOnboardingIntake(app: object, input: { domain: string, phone: string, notes: string }): Promise<GtmCompletedOnboardingCompletionStatus> {
  const onboarding = onboardingStatusSchema.parse(await requestJson(app, "/onboarding/details", { method: "POST", body: JSON.stringify(input) }, "admin"));
  if (!onboarding.completed) {
    throw new Error("Completing GTM onboarding returned an incomplete onboarding state.");
  }
  return onboarding;
}

export async function listGtmOnboardedProjects(app: object): Promise<GtmOnboardedProject[]> {
  const response = z.object({
    items: z.array(onboardedProjectSchema),
  }).parse(await requestJson(app, "/onboarding/projects"));
  return response.items.map((project) => ({
    id: project.id,
    displayName: project.display_name,
    completedAtMillis: project.completed_at_millis,
    details: project.details,
  }));
}

export async function createInsight(app: object, draft: GtmInsightDraft, targetProjectId = "internal"): Promise<GtmInsight> {
  return mapInsight(insightSchema.parse(await requestJson(app, "/insights", { method: "POST", body: JSON.stringify({ target_project_id: targetProjectId, domain: draft.domain, title: draft.title, body: draft.body, impact_score: draft.impactScore, times_seen: draft.timesSeen, timeline_entries: timelineToWire(draft.timeline) }) })));
}
export async function updateInsight(app: object, value: GtmInsight, targetProjectId = "internal"): Promise<GtmInsight> {
  return mapInsight(insightSchema.parse(await requestJson(app, urlString`/insights/${value.id}`, { method: "PATCH", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis, domain: value.domain, title: value.title, body: value.body, impact_score: value.impactScore, times_seen: value.timesSeen, timeline_entries: timelineToWire(value.timeline) }) })));
}
export async function deleteInsight(app: object, value: GtmInsight, targetProjectId = "internal"): Promise<void> {
  await requestJson(app, urlString`/insights/${value.id}`, { method: "DELETE", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis }) });
}

export async function createAction(app: object, draft: GtmActionDraft, targetProjectId = "internal"): Promise<GtmAction> {
  return mapAction(actionSchema.parse(await requestJson(app, "/actions", { method: "POST", body: JSON.stringify({ target_project_id: targetProjectId, domain: draft.domain, type: draft.type, status: draft.status, title: draft.title, summary: draft.summary, verdict: draft.verdict, retrospective_text: draft.retrospective, expires_at_millis: draft.expiresAtMillis, executed_at_millis: draft.executedAtMillis, timeline_entries: timelineToWire(draft.timeline) }) })));
}
export async function updateAction(app: object, value: GtmAction, targetProjectId = "internal"): Promise<GtmAction> {
  return mapAction(actionSchema.parse(await requestJson(app, urlString`/actions/${value.id}`, { method: "PATCH", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis, domain: value.domain, type: value.type, status: value.status, title: value.title, summary: value.summary, verdict: value.verdict, retrospective_text: value.retrospective, expires_at_millis: value.expiresAtMillis, executed_at_millis: value.executedAtMillis, timeline_entries: timelineToWire(value.timeline) }) })));
}
export async function deleteAction(app: object, value: GtmAction, targetProjectId = "internal"): Promise<void> {
  await requestJson(app, urlString`/actions/${value.id}`, { method: "DELETE", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis }) });
}

export async function createNote(app: object, draft: GtmNoteDraft, targetProjectId = "internal"): Promise<GtmNote> {
  return mapNote(noteSchema.parse(await requestJson(app, "/notes", { method: "POST", body: JSON.stringify({ target_project_id: targetProjectId, domain: draft.domain, category: draft.category, title: draft.title, body: draft.body, source: draft.source }) })));
}
export async function updateNote(app: object, value: GtmNote, targetProjectId = "internal"): Promise<GtmNote> {
  if (value.title == null) {
    throw new Error("A GTM note must have a title before it can be updated.");
  }
  return mapNote(noteSchema.parse(await requestJson(app, urlString`/notes/${value.id}`, { method: "PATCH", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis, domain: value.domain, category: value.category, title: value.title, body: value.body, source: value.source }) })));
}
export async function deleteNote(app: object, value: GtmNote, targetProjectId = "internal"): Promise<void> {
  await requestJson(app, urlString`/notes/${value.id}`, { method: "DELETE", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis }) });
}
