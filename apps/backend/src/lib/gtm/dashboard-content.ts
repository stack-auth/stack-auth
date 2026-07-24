import type {
  GtmAction as PrismaGtmAction,
  GtmInsight as PrismaGtmInsight,
  GtmNote as PrismaGtmNote,
  GtmOnboarding as PrismaGtmOnboarding,
} from "@/generated/prisma/client";
import { ensurePlatformAdmin } from "@/lib/platform-admin";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { KnownErrors } from "@hexclave/shared";
import type { UsersCrud } from "@hexclave/shared/dist/interface/crud/users";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";

export const GTM_INSIGHT_KINDS = [
  "funnel_dropoff",
  "segment_lift",
  "retention",
  "send_time",
  "checkout_abandonment",
  "friction_hotspot",
  "qualitative_theme",
  "data_gap",
  "measurement",
] as const;
export const GTM_INSIGHT_STATUSES = ["new", "surfaced", "acknowledged", "dismissed", "measured", "archived"] as const;
export const GTM_CONFIDENCES = ["high", "medium", "low"] as const;
export const GTM_ACTION_TYPES = ["checkout_recovery_email", "broadcast_email", "config_change"] as const;
export const GTM_ACTION_STATUSES = ["proposed", "approved", "executing", "executed", "failed", "rejected", "expired"] as const;
export const GTM_VERDICTS = ["worked", "didnt_work", "inconclusive", "never_measured", "rejected_by_you", "expired"] as const;
export const GTM_NOTE_CATEGORIES = ["company", "audience", "strategy", "user_preference", "learning"] as const;
export const GTM_NOTE_SOURCES = ["chat", "run", "user"] as const;
export const GTM_DOMAINS = ["product", "users", "ads", "outreach", "content", "revenue"] as const;

const INTERNAL_PROJECT_ID = "internal";
const PAGE_SIZE = 100;

type GtmAdminUser = UsersCrud["Admin"]["Read"];

async function ensureInternalGtmAdmin(authProjectId: string, user: GtmAdminUser | null | undefined): Promise<void> {
  if (user == null) throw new KnownErrors.UserAuthenticationRequired();
  if (authProjectId !== INTERNAL_PROJECT_ID) throw new KnownErrors.ExpectedInternalProject();
  await ensurePlatformAdmin(user);
}

export async function requireGtmReadProject(options: {
  authProjectId: string,
  user: GtmAdminUser | null | undefined,
  targetProjectId?: string,
}): Promise<string> {
  if (options.user == null) throw new KnownErrors.UserAuthenticationRequired();
  if (options.targetProjectId == null || options.targetProjectId === options.authProjectId) return options.authProjectId;
  await ensureInternalGtmAdmin(options.authProjectId, options.user);
  const target = await globalPrismaClient.project.findUnique({ where: { id: options.targetProjectId }, select: { id: true } });
  if (target == null) throw new StatusError(404, "GTM project not found.");
  return target.id;
}

export async function requireGtmWriteProject(options: {
  authProjectId: string,
  user: GtmAdminUser | null | undefined,
  targetProjectId: string,
}): Promise<string> {
  await ensureInternalGtmAdmin(options.authProjectId, options.user);
  const target = await globalPrismaClient.project.findUnique({ where: { id: options.targetProjectId }, select: { id: true } });
  if (target == null) throw new StatusError(404, "GTM project not found.");
  return target.id;
}

export async function listGtmOnboardedProjects(options: {
  authProjectId: string,
  user: GtmAdminUser | null | undefined,
}) {
  await ensureInternalGtmAdmin(options.authProjectId, options.user);
  const onboardings = await globalPrismaClient.gtmOnboarding.findMany({
    where: {
      branchId: DEFAULT_BRANCH_ID,
      projectId: { not: INTERNAL_PROJECT_ID },
    },
    select: {
      completedAt: true,
      domain: true,
      phone: true,
      notes: true,
      project: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
    orderBy: [
      { project: { displayName: "asc" } },
      { projectId: "asc" },
    ],
  });
  return onboardings.map(({ completedAt, domain, phone, notes, project }) => ({
    id: project.id,
    display_name: project.displayName,
    completed_at_millis: completedAt.getTime(),
    details: {
      domain,
      phone,
      notes,
    },
  }));
}

function normalizeGtmDomain(value: string | undefined): string | null {
  const trimmedValue = value?.trim() ?? "";
  if (trimmedValue.length === 0) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmedValue);
  } catch {
    throw new StatusError(400, "domain must be a valid website URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new StatusError(400, "domain must use http or https");
  }
  if (url.hostname.length === 0) {
    throw new StatusError(400, "domain must include a hostname");
  }
  return url.hostname;
}

function serializeOnboarding(row: PrismaGtmOnboarding) {
  return {
    completed: true,
    completed_at_millis: row.completedAt.getTime(),
    details: {
      domain: row.domain,
      phone: row.phone,
      notes: row.notes,
    },
  };
}

export async function getGtmOnboardingStatus(projectId: string) {
  const onboarding = await globalPrismaClient.gtmOnboarding.findUnique({
    where: { projectId_branchId: { projectId, branchId: DEFAULT_BRANCH_ID } },
    select: { completedAt: true },
  });
  return onboarding == null
    ? { completed: false, completed_at_millis: null }
    : { completed: true, completed_at_millis: onboarding.completedAt.getTime() };
}

export async function getGtmOnboarding(projectId: string) {
  const onboarding = await globalPrismaClient.gtmOnboarding.findUnique({
    where: { projectId_branchId: { projectId, branchId: DEFAULT_BRANCH_ID } },
  });
  return onboarding == null
    ? { completed: false, completed_at_millis: null, details: null }
    : serializeOnboarding(onboarding);
}

export async function completeGtmOnboarding(projectId: string, input: { domain?: string, phone: string, notes?: string }) {
  const domain = normalizeGtmDomain(input.domain);
  const phone = input.phone.trim();
  const notes = input.notes?.trim() ?? "";
  const onboarding = await globalPrismaClient.gtmOnboarding.upsert({
    where: { projectId_branchId: { projectId, branchId: DEFAULT_BRANCH_ID } },
    create: { projectId, branchId: DEFAULT_BRANCH_ID, domain, phone, notes },
    update: { domain, phone, notes },
  });
  return serializeOnboarding(onboarding);
}

function serializeInsight(row: PrismaGtmInsight) {
  return {
    id: row.id,
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
    domain: row.domain,
    kind: row.kind,
    status: row.status,
    confidence: row.confidence,
    title: row.title,
    body: row.body,
    impact_score: row.impactScore,
    times_seen: row.timesSeen,
    last_seen_at_millis: row.lastSeenAt.getTime(),
  };
}

function serializeAction(row: PrismaGtmAction) {
  return {
    id: row.id,
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
    domain: row.domain,
    type: row.type,
    status: row.status,
    title: row.title,
    summary: row.summary,
    verdict: row.verdict,
    retrospective_text: row.retrospectiveText,
    expires_at_millis: row.expiresAt.getTime(),
    executed_at_millis: row.executedAt?.getTime() ?? null,
  };
}

function serializeNote(row: PrismaGtmNote) {
  return {
    id: row.id,
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
    domain: row.domain,
    category: row.category,
    title: row.title,
    body: row.body,
    source: row.source,
    last_confirmed_at_millis: row.lastConfirmedAt.getTime(),
  };
}

function dateFromMillis(value: number, field: string): Date {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new StatusError(400, `${field} must be a valid timestamp`);
  return result;
}

function nullableDateFromMillis(value: number | null | undefined, field: string): Date | null | undefined {
  if (value == null) return value;
  return dateFromMillis(value, field);
}

function nextUpdatedAt(expectedUpdatedAtMillis: number): Date {
  // The API exposes millisecond timestamps, so force the next revision to be
  // representably newer even when two mutations land in the same millisecond.
  return new Date(Math.max(new Date().getTime(), expectedUpdatedAtMillis + 1));
}

async function throwMissingOrConflict(resource: "insight" | "action" | "note", exists: boolean): Promise<never> {
  if (!exists) throw new StatusError(404, `GTM ${resource} not found.`);
  throw new StatusError(409, `This GTM ${resource} changed since it was loaded. Refresh and try again.`);
}

export async function listGtmInsights(projectId: string, cursor: string | undefined) {
  const rows = await globalPrismaClient.gtmInsight.findMany({
    where: { projectId, branchId: DEFAULT_BRANCH_ID },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor == null ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const items = rows.slice(0, PAGE_SIZE);
  return {
    items: items.map(serializeInsight),
    next_cursor: rows.length > PAGE_SIZE ? items.at(-1)?.id ?? null : null,
  };
}

export async function createGtmInsight(projectId: string, input: {
  domain: string,
  kind: string,
  status: string,
  confidence: string,
  title: string,
  body: string,
  impact_score: number,
  times_seen?: number,
}) {
  const row = await globalPrismaClient.gtmInsight.create({
    data: {
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      domain: input.domain,
      kind: input.kind,
      status: input.status,
      confidence: input.confidence,
      title: input.title,
      body: input.body,
      impactScore: input.impact_score,
      timesSeen: input.times_seen ?? 1,
    },
  });
  return serializeInsight(row);
}

export async function updateGtmInsight(projectId: string, id: string, input: {
  expected_updated_at_millis: number,
  domain: string,
  kind: string,
  status: string,
  confidence: string,
  title: string,
  body: string,
  impact_score: number,
  times_seen: number,
}) {
  const result = await globalPrismaClient.gtmInsight.updateMany({
    where: {
      id,
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      updatedAt: dateFromMillis(input.expected_updated_at_millis, "expected_updated_at_millis"),
    },
    data: {
      domain: input.domain,
      kind: input.kind,
      status: input.status,
      confidence: input.confidence,
      title: input.title,
      body: input.body,
      impactScore: input.impact_score,
      timesSeen: input.times_seen,
      lastSeenAt: new Date(),
      updatedAt: nextUpdatedAt(input.expected_updated_at_millis),
    },
  });
  if (result.count === 0) {
    const exists = await globalPrismaClient.gtmInsight.findFirst({ where: { id, projectId, branchId: DEFAULT_BRANCH_ID }, select: { id: true } });
    await throwMissingOrConflict("insight", exists != null);
  }
  return serializeInsight(await globalPrismaClient.gtmInsight.findUnique({ where: { id } }) ?? throwErr("Updated GTM insight disappeared"));
}

export async function deleteGtmInsight(projectId: string, id: string, expectedUpdatedAtMillis: number): Promise<void> {
  const result = await globalPrismaClient.gtmInsight.deleteMany({
    where: { id, projectId, branchId: DEFAULT_BRANCH_ID, updatedAt: dateFromMillis(expectedUpdatedAtMillis, "expected_updated_at_millis") },
  });
  if (result.count === 0) {
    const exists = await globalPrismaClient.gtmInsight.findFirst({ where: { id, projectId, branchId: DEFAULT_BRANCH_ID }, select: { id: true } });
    await throwMissingOrConflict("insight", exists != null);
  }
}

export async function listGtmActions(projectId: string, cursor: string | undefined) {
  const rows = await globalPrismaClient.gtmAction.findMany({
    where: { projectId, branchId: DEFAULT_BRANCH_ID },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor == null ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const items = rows.slice(0, PAGE_SIZE);
  return { items: items.map(serializeAction), next_cursor: rows.length > PAGE_SIZE ? items.at(-1)?.id ?? null : null };
}

export async function createGtmAction(projectId: string, input: {
  domain: string,
  type: string,
  status: string,
  title: string,
  summary: string,
  verdict?: string | null,
  retrospective_text?: string | null,
  expires_at_millis: number,
  executed_at_millis?: number | null,
}) {
  const row = await globalPrismaClient.gtmAction.create({
    data: {
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      domain: input.domain,
      type: input.type,
      status: input.status,
      title: input.title,
      summary: input.summary,
      verdict: input.verdict ?? null,
      retrospectiveText: input.retrospective_text ?? null,
      expiresAt: dateFromMillis(input.expires_at_millis, "expires_at_millis"),
      executedAt: nullableDateFromMillis(input.executed_at_millis, "executed_at_millis") ?? null,
    },
  });
  return serializeAction(row);
}

export async function updateGtmAction(projectId: string, id: string, input: {
  expected_updated_at_millis: number,
  domain: string,
  type: string,
  status: string,
  title: string,
  summary: string,
  verdict: string | null,
  retrospective_text: string | null,
  expires_at_millis: number,
  executed_at_millis: number | null,
}) {
  const result = await globalPrismaClient.gtmAction.updateMany({
    where: { id, projectId, branchId: DEFAULT_BRANCH_ID, updatedAt: dateFromMillis(input.expected_updated_at_millis, "expected_updated_at_millis") },
    data: {
      domain: input.domain,
      type: input.type,
      status: input.status,
      title: input.title,
      summary: input.summary,
      verdict: input.verdict,
      retrospectiveText: input.retrospective_text,
      expiresAt: dateFromMillis(input.expires_at_millis, "expires_at_millis"),
      executedAt: nullableDateFromMillis(input.executed_at_millis, "executed_at_millis") ?? null,
      updatedAt: nextUpdatedAt(input.expected_updated_at_millis),
    },
  });
  if (result.count === 0) {
    const exists = await globalPrismaClient.gtmAction.findFirst({ where: { id, projectId, branchId: DEFAULT_BRANCH_ID }, select: { id: true } });
    await throwMissingOrConflict("action", exists != null);
  }
  return serializeAction(await globalPrismaClient.gtmAction.findUnique({ where: { id } }) ?? throwErr("Updated GTM action disappeared"));
}

export async function deleteGtmAction(projectId: string, id: string, expectedUpdatedAtMillis: number): Promise<void> {
  const result = await globalPrismaClient.gtmAction.deleteMany({
    where: { id, projectId, branchId: DEFAULT_BRANCH_ID, updatedAt: dateFromMillis(expectedUpdatedAtMillis, "expected_updated_at_millis") },
  });
  if (result.count === 0) {
    const exists = await globalPrismaClient.gtmAction.findFirst({ where: { id, projectId, branchId: DEFAULT_BRANCH_ID }, select: { id: true } });
    await throwMissingOrConflict("action", exists != null);
  }
}

export async function listGtmNotes(projectId: string, cursor: string | undefined) {
  const rows = await globalPrismaClient.gtmNote.findMany({
    where: { projectId, branchId: DEFAULT_BRANCH_ID },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor == null ? {} : { cursor: { id: cursor }, skip: 1 }),
  });
  const items = rows.slice(0, PAGE_SIZE);
  return { items: items.map(serializeNote), next_cursor: rows.length > PAGE_SIZE ? items.at(-1)?.id ?? null : null };
}

export async function createGtmNote(projectId: string, input: { domain: string, category: string, title: string, body: string, source: string }) {
  const row = await globalPrismaClient.gtmNote.create({
    data: {
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      domain: input.domain,
      category: input.category,
      title: input.title,
      body: input.body,
      source: input.source,
    },
  });
  return serializeNote(row);
}

export async function updateGtmNote(projectId: string, id: string, input: {
  expected_updated_at_millis: number,
  domain: string,
  category: string,
  title: string,
  body: string,
  source: string,
}) {
  const result = await globalPrismaClient.gtmNote.updateMany({
    where: { id, projectId, branchId: DEFAULT_BRANCH_ID, updatedAt: dateFromMillis(input.expected_updated_at_millis, "expected_updated_at_millis") },
    data: {
      domain: input.domain,
      category: input.category,
      title: input.title,
      body: input.body,
      source: input.source,
      lastConfirmedAt: new Date(),
      updatedAt: nextUpdatedAt(input.expected_updated_at_millis),
    },
  });
  if (result.count === 0) {
    const exists = await globalPrismaClient.gtmNote.findFirst({ where: { id, projectId, branchId: DEFAULT_BRANCH_ID }, select: { id: true } });
    await throwMissingOrConflict("note", exists != null);
  }
  return serializeNote(await globalPrismaClient.gtmNote.findUnique({ where: { id } }) ?? throwErr("Updated GTM note disappeared"));
}

export async function deleteGtmNote(projectId: string, id: string, expectedUpdatedAtMillis: number): Promise<void> {
  const result = await globalPrismaClient.gtmNote.deleteMany({
    where: { id, projectId, branchId: DEFAULT_BRANCH_ID, updatedAt: dateFromMillis(expectedUpdatedAtMillis, "expected_updated_at_millis") },
  });
  if (result.count === 0) {
    const exists = await globalPrismaClient.gtmNote.findFirst({ where: { id, projectId, branchId: DEFAULT_BRANCH_ID }, select: { id: true } });
    await throwMissingOrConflict("note", exists != null);
  }
}
