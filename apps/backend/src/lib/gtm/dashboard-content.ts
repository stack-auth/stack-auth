import { Prisma } from "@/generated/prisma/client";
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
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { yupArray, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

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
  authType: "client" | "server" | "admin",
  authProjectId: string,
  user: GtmAdminUser | null | undefined,
  targetProjectId?: string,
}): Promise<string> {
  if (options.targetProjectId == null || options.targetProjectId === options.authProjectId) {
    // Reading a project's own GTM data needs proof that the caller owns the project, and there are two
    // distinct ways to hold that proof. The project dashboard reads through the owned-project admin app,
    // which is constructed with `tokenStore === null` and therefore never sends an access token — for it,
    // possession of the admin key IS the authorization and `auth.user` is structurally always null. The
    // internal GTM pages instead read through the dashboard's own user session, which is a client request
    // carrying a real user. Requiring a user unconditionally locked out the former; requiring admin
    // unconditionally would lock out the latter, so accept either.
    if (options.authType !== "admin" && options.user == null) throw new KnownErrors.UserAuthenticationRequired();
    return options.authProjectId;
  }
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

export const GTM_TIMELINE_MAX_ENTRIES = 40;
export const GTM_TIMELINE_LABEL_MAX_LENGTH = 40;
export const GTM_TIMELINE_TITLE_MAX_LENGTH = 200;
export const GTM_TIMELINE_BODY_MAX_LENGTH = 2000;

export type GtmTimelineEntryInput = {
  label: string,
  title: string,
  body: string,
  date_millis: number,
};

/**
 * Request-body schema for a curated timeline, shared by every route that can write one so the four call sites
 * cannot drift apart. Optional and nullable are both meaningful and distinct here: omitted leaves the stored
 * timeline untouched, `null` clears it back to "nothing written yet".
 */
export const gtmTimelineEntriesSchema = yupArray(yupObject({
  label: yupString().trim().min(1).max(GTM_TIMELINE_LABEL_MAX_LENGTH).defined(),
  title: yupString().trim().min(1).max(GTM_TIMELINE_TITLE_MAX_LENGTH).defined(),
  body: yupString().trim().max(GTM_TIMELINE_BODY_MAX_LENGTH).default(""),
  date_millis: yupNumber().defined(),
}).defined()).max(GTM_TIMELINE_MAX_ENTRIES).nullable().optional();

/**
 * Reads a curated timeline back out of its JSON column.
 *
 * The column is `Json?`, so Prisma types it as `JsonValue` and the database only guarantees "NULL or a JSON
 * array" (the CHECK constraint). Everything past that is validated here rather than trusted, because a row
 * could have been written by an older or a hand-run query. Anything that does not match the expected entry
 * shape is a bug we want to see rather than paper over, so it throws instead of being dropped silently.
 */
function deserializeTimeline(value: PrismaGtmInsight["timelineEntries"]): GtmTimelineEntryInput[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) throw new HexclaveAssertionError(`A GTM timeline column held ${typeof value} instead of an array or NULL.`);
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry == null || Array.isArray(entry)) {
      throw new HexclaveAssertionError(`GTM timeline entry ${index} is not an object.`);
    }
    const record: Record<string, unknown> = entry;
    const { label, title, body, date_millis: dateMillis } = record;
    if (typeof label !== "string" || typeof title !== "string" || typeof body !== "string" || typeof dateMillis !== "number") {
      throw new HexclaveAssertionError(`GTM timeline entry ${index} has fields of unexpected types.`);
    }
    return { label, title, body, date_millis: dateMillis };
  });
}

/**
 * Normalizes a curated timeline on the way in.
 *
 * `undefined` means the caller did not mention the timeline at all and whatever is stored must be left alone;
 * `null` means "clear the timeline back to nothing written yet". Those are genuinely different
 * intents, so they map to different Prisma values (field omitted vs. `Prisma.DbNull`) and must not be
 * collapsed. Length limits are enforced here as well as in the route schema, since this is the single point
 * every write path goes through.
 */
function normalizeTimelineForWrite(entries: GtmTimelineEntryInput[] | null | undefined): GtmTimelineEntryInput[] | null | undefined {
  if (entries === undefined) return undefined;
  if (entries === null) return null;
  if (entries.length > GTM_TIMELINE_MAX_ENTRIES) {
    throw new StatusError(400, `A GTM timeline cannot have more than ${GTM_TIMELINE_MAX_ENTRIES} entries.`);
  }
  return entries.map((entry, index) => {
    const label = entry.label.trim();
    const title = entry.title.trim();
    const body = entry.body.trim();
    if (label.length === 0 || title.length === 0) {
      throw new StatusError(400, `GTM timeline entry ${index + 1} needs both a label and a title.`);
    }
    if (label.length > GTM_TIMELINE_LABEL_MAX_LENGTH || title.length > GTM_TIMELINE_TITLE_MAX_LENGTH || body.length > GTM_TIMELINE_BODY_MAX_LENGTH) {
      throw new StatusError(400, `GTM timeline entry ${index + 1} is too long.`);
    }
    if (!Number.isFinite(entry.date_millis)) {
      throw new StatusError(400, `GTM timeline entry ${index + 1} has an invalid date.`);
    }
    return { label, title, body, date_millis: entry.date_millis };
  });
}

/**
 * Translates the normalized value into the `data` fragment Prisma expects. `Prisma.DbNull` (not JS `null`)
 * is what writes a SQL NULL into a `Json?` column; plain `null` would be rejected by Prisma's types.
 */
function timelineWriteData(entries: GtmTimelineEntryInput[] | null | undefined) {
  const normalized = normalizeTimelineForWrite(entries);
  if (normalized === undefined) return {};
  return { timelineEntries: normalized === null ? Prisma.DbNull : normalized };
}

function serializeInsight(row: PrismaGtmInsight) {
  return {
    timeline_entries: deserializeTimeline(row.timelineEntries),
    id: row.id,
    created_at_millis: row.createdAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
    domain: row.domain,
    title: row.title,
    body: row.body,
    impact_score: row.impactScore,
    times_seen: row.timesSeen,
    last_seen_at_millis: row.lastSeenAt.getTime(),
  };
}

function serializeAction(row: PrismaGtmAction) {
  return {
    timeline_entries: deserializeTimeline(row.timelineEntries),
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
  title: string,
  body: string,
  impact_score: number,
  times_seen?: number,
  timeline_entries?: GtmTimelineEntryInput[] | null,
}) {
  const row = await globalPrismaClient.gtmInsight.create({
    data: {
      projectId,
      branchId: DEFAULT_BRANCH_ID,
      domain: input.domain,
      title: input.title,
      body: input.body,
      impactScore: input.impact_score,
      timesSeen: input.times_seen ?? 1,
      ...timelineWriteData(input.timeline_entries),
    },
  });
  return serializeInsight(row);
}

export async function updateGtmInsight(projectId: string, id: string, input: {
  expected_updated_at_millis: number,
  domain: string,
  title: string,
  body: string,
  impact_score: number,
  times_seen: number,
  timeline_entries?: GtmTimelineEntryInput[] | null,
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
      title: input.title,
      body: input.body,
      impactScore: input.impact_score,
      timesSeen: input.times_seen,
      lastSeenAt: new Date(),
      ...timelineWriteData(input.timeline_entries),
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
  timeline_entries?: GtmTimelineEntryInput[] | null,
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
      ...timelineWriteData(input.timeline_entries),
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
  timeline_entries?: GtmTimelineEntryInput[] | null,
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
      ...timelineWriteData(input.timeline_entries),
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
