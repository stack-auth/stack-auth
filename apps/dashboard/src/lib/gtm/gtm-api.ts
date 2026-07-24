import { sendInternalAdminRequest, sendInternalUserRequest } from "@/lib/hexclave-app-internals";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { z } from "zod";
import {
  GTM_ACTION_STATUSES,
  GTM_ACTION_TYPES,
  GTM_CONFIDENCES,
  GTM_DOMAINS,
  GTM_INSIGHT_KINDS,
  GTM_INSIGHT_STATUSES,
  GTM_NOTE_CATEGORIES,
  GTM_NOTE_SOURCES,
  GTM_VERDICTS,
  type GtmAction,
  type GtmInsight,
  type GtmNote,
} from "./gtm-types";

const insightSchema = z.object({
  id: z.string().uuid(), created_at_millis: z.number(), updated_at_millis: z.number(), domain: z.enum(GTM_DOMAINS), kind: z.enum(GTM_INSIGHT_KINDS),
  status: z.enum(GTM_INSIGHT_STATUSES), confidence: z.enum(GTM_CONFIDENCES), title: z.string(), body: z.string(),
  impact_score: z.number(), times_seen: z.number(), last_seen_at_millis: z.number(),
});
const actionSchema = z.object({
  id: z.string().uuid(), created_at_millis: z.number(), updated_at_millis: z.number(), domain: z.enum(GTM_DOMAINS), type: z.enum(GTM_ACTION_TYPES),
  status: z.enum(GTM_ACTION_STATUSES), title: z.string(), summary: z.string(), verdict: z.enum(GTM_VERDICTS).nullable(),
  retrospective_text: z.string().nullable(), expires_at_millis: z.number(), executed_at_millis: z.number().nullable(),
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
const onboardedProjectSchema = z.object({
  id: z.string(),
  display_name: z.string(),
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
export type GtmCompletedOnboardingStatus = Extract<GtmOnboardingStatus, { completed: true }>;
export type GtmOnboardingDetails = z.infer<typeof onboardingDetailsSchema>;
export type GtmOnboardedProject = {
  id: string,
  displayName: string,
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

function mapInsight(value: z.infer<typeof insightSchema>): GtmInsight {
  return { id: value.id, createdAtMillis: value.created_at_millis, updatedAtMillis: value.updated_at_millis, domain: value.domain, kind: value.kind, status: value.status, confidence: value.confidence, title: value.title, body: value.body, impactScore: value.impact_score, timesSeen: value.times_seen, lastSeenAtMillis: value.last_seen_at_millis };
}
function mapAction(value: z.infer<typeof actionSchema>): GtmAction {
  return { id: value.id, createdAtMillis: value.created_at_millis, updatedAtMillis: value.updated_at_millis, domain: value.domain, type: value.type, status: value.status, title: value.title, summary: value.summary, verdict: value.verdict, retrospective: value.retrospective_text, expiresAtMillis: value.expires_at_millis, executedAtMillis: value.executed_at_millis };
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

async function listAll<T>(app: object, path: string, schema: z.ZodType<T>, projectId?: string): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | null = null;
  do {
    const page = z.object({ items: z.array(schema), next_cursor: z.string().nullable() }).parse(await requestJson(app, projectQuery(path, projectId, cursor)));
    result.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor != null);
  return result;
}

export async function loadGtmDataset(app: object, projectId?: string) {
  const [insights, actions, notes] = await Promise.all([
    listAll(app, "/insights", insightSchema, projectId), listAll(app, "/actions", actionSchema, projectId), listAll(app, "/notes", noteSchema, projectId),
  ]);
  return { insights: insights.map(mapInsight), actions: actions.map(mapAction), notes: notes.map(mapNote), radar: null };
}

export async function getGtmOnboarding(app: object): Promise<GtmOnboardingStatus> {
  return onboardingSchema.parse(await requestJson(app, "/onboarding/details", {}, "admin"));
}

export async function completeGtmOnboarding(app: object, input: { domain: string, phone: string, notes: string }): Promise<GtmCompletedOnboardingStatus> {
  const onboarding = onboardingSchema.parse(await requestJson(app, "/onboarding/details", { method: "POST", body: JSON.stringify(input) }, "admin"));
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
  }));
}

export async function createInsight(app: object, draft: GtmInsightDraft, targetProjectId = "internal"): Promise<GtmInsight> {
  return mapInsight(insightSchema.parse(await requestJson(app, "/insights", { method: "POST", body: JSON.stringify({ target_project_id: targetProjectId, domain: draft.domain, kind: draft.kind, status: draft.status, confidence: draft.confidence, title: draft.title, body: draft.body, impact_score: draft.impactScore, times_seen: draft.timesSeen }) })));
}
export async function updateInsight(app: object, value: GtmInsight, targetProjectId = "internal"): Promise<GtmInsight> {
  return mapInsight(insightSchema.parse(await requestJson(app, urlString`/insights/${value.id}`, { method: "PATCH", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis, domain: value.domain, kind: value.kind, status: value.status, confidence: value.confidence, title: value.title, body: value.body, impact_score: value.impactScore, times_seen: value.timesSeen }) })));
}
export async function deleteInsight(app: object, value: GtmInsight, targetProjectId = "internal"): Promise<void> {
  await requestJson(app, urlString`/insights/${value.id}`, { method: "DELETE", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis }) });
}

export async function createAction(app: object, draft: GtmActionDraft, targetProjectId = "internal"): Promise<GtmAction> {
  return mapAction(actionSchema.parse(await requestJson(app, "/actions", { method: "POST", body: JSON.stringify({ target_project_id: targetProjectId, domain: draft.domain, type: draft.type, status: draft.status, title: draft.title, summary: draft.summary, verdict: draft.verdict, retrospective_text: draft.retrospective, expires_at_millis: draft.expiresAtMillis, executed_at_millis: draft.executedAtMillis }) })));
}
export async function updateAction(app: object, value: GtmAction, targetProjectId = "internal"): Promise<GtmAction> {
  return mapAction(actionSchema.parse(await requestJson(app, urlString`/actions/${value.id}`, { method: "PATCH", body: JSON.stringify({ target_project_id: targetProjectId, expected_updated_at_millis: value.updatedAtMillis, domain: value.domain, type: value.type, status: value.status, title: value.title, summary: value.summary, verdict: value.verdict, retrospective_text: value.retrospective, expires_at_millis: value.expiresAtMillis, executed_at_millis: value.executedAtMillis }) })));
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
