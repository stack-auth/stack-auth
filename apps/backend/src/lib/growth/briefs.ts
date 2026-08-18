import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { HexclaveAssertionError, StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";

/**
 * Read/ack logic behind the internal/growth/briefs/* admin routes, kept out of the route files the
 * same way lib/growth/actions.ts backs the report/action routes. Wire shapes here must match the
 * frozen zod schemas in the dashboard's growth-api.ts exactly (snake_case fields, *_at_millis
 * timestamps, `date` as YYYY-MM-DD).
 */

export const GROWTH_BRIEF_STATUSES = ["generating", "ready", "failed", "skipped"] as const;
export type GrowthBriefStatus = typeof GROWTH_BRIEF_STATUSES[number];

const DEFAULT_BRIEFS_PAGE_SIZE = 50;
const MAX_BRIEFS_PAGE_SIZE = 100;

function assertBriefStatus(value: string): GrowthBriefStatus {
  return GROWTH_BRIEF_STATUSES.find((candidate) => candidate === value)
    ?? throwErr(new HexclaveAssertionError(`GrowthBrief.status contained an unknown value "${value}" — statuses are only ever written from the fixed set, so this should be impossible.`, { value }));
}

// Structural row type instead of the generated Prisma model type: it keeps this module decoupled
// from Prisma's generated namespace and documents exactly which columns the wire mapping reads.
type GrowthBriefRow = {
  id: string,
  date: Date,
  status: string,
  summary: string,
  contentMd: string,
  document?: unknown,
  readAt: Date | null,
  createdAt: Date,
};

function growthBriefToWire(brief: GrowthBriefRow) {
  return {
    id: brief.id,
    // @db.Date column: the stored value is always UTC midnight, so slicing the ISO string is exact.
    date: brief.date.toISOString().slice(0, 10),
    status: assertBriefStatus(brief.status),
    summary: brief.summary,
    content_md: brief.contentMd,
    document: brief.document ?? null,
    read_at_millis: brief.readAt == null ? null : brief.readAt.getTime(),
    created_at_millis: brief.createdAt.getTime(),
  };
}

export async function listGrowthBriefsBody(tenancy: Tenancy, options: {
  cursor: string | undefined,
  limit: number | undefined,
}) {
  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;
  const limit = Math.max(1, Math.min(MAX_BRIEFS_PAGE_SIZE, options.limit ?? DEFAULT_BRIEFS_PAGE_SIZE));

  // Newest-first by `date` (not createdAt, unlike the actions list): briefs are a one-per-day
  // resource and the agent may backfill an older day later, which must not surface at the top of
  // the list — the same reasoning as the status route's latest_brief using date desc. `date` is
  // unique per (projectId, branchId), so (date desc, id desc) is a total, stable order.
  //
  // The cursor is the last item's id (same convention as the actions list). The pivot row is looked
  // up fresh so pagination stays anchored on (date, id) even though the cursor itself is opaque to
  // the client.
  let cursorPivot: { date: Date, id: string } | null = null;
  if (options.cursor != null) {
    if (!isUuid(options.cursor)) {
      throw new StatusError(400, "Invalid cursor.");
    }
    const pivotRow = await globalPrismaClient.growthBrief.findFirst({
      where: { id: options.cursor, projectId, branchId },
      select: { id: true, date: true },
    });
    if (pivotRow == null) {
      throw new StatusError(400, "Invalid cursor.");
    }
    cursorPivot = pivotRow;
  }

  const rows = await globalPrismaClient.growthBrief.findMany({
    where: {
      projectId,
      branchId,
      ...cursorPivot == null ? {} : {
        OR: [
          { date: { lt: cursorPivot.date } },
          { date: cursorPivot.date, id: { lt: cursorPivot.id } },
        ],
      },
    },
    orderBy: [{ date: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastPageItem = page.length === 0 ? null : page[page.length - 1] ?? throwErr(new HexclaveAssertionError("Non-empty page has no last element — impossible."));
  return {
    items: page.map(growthBriefToWire),
    next_cursor: hasMore && lastPageItem != null ? lastPageItem.id : null,
  };
}

async function requireBriefInTenancy(tenancy: Tenancy, briefId: string) {
  // A non-UUID id can never match a row, but Prisma would turn it into a Postgres cast error (a
  // 500) instead of a clean miss — so pre-check and 404 early. Same 404 whether the brief doesn't
  // exist or belongs to another project — no id probing.
  if (!isUuid(briefId)) {
    throw new StatusError(404, "Brief not found.");
  }
  const brief = await globalPrismaClient.growthBrief.findFirst({
    where: { id: briefId, projectId: tenancy.project.id, branchId: tenancy.branchId },
  });
  if (brief == null) {
    throw new StatusError(404, "Brief not found.");
  }
  return brief;
}

export async function getGrowthBriefBody(tenancy: Tenancy, briefId: string) {
  return growthBriefToWire(await requireBriefInTenancy(tenancy, briefId));
}

/**
 * Marks a brief read (readAt = now) if it isn't already; a second call is a no-op that keeps the
 * original timestamp. Any status is markable on purpose — the dashboard shows generating/failed
 * briefs honestly, and opening one is still "the user has seen it".
 */
export async function markGrowthBriefReadBody(tenancy: Tenancy, briefId: string): Promise<{ status: GrowthBriefStatus }> {
  const brief = await requireBriefInTenancy(tenancy, briefId);
  if (brief.readAt == null) {
    // Guarding on readAt: null makes the first-read timestamp race-free: two concurrent reads both
    // pass the check above, but only one updateMany matches, so readAt is written exactly once.
    await globalPrismaClient.growthBrief.updateMany({
      where: { id: brief.id, readAt: null },
      data: { readAt: new Date() },
    });
  }
  // Ack shape per the frozen dashboard contract: mutations that leave a resource behind return that
  // resource's resulting status. Reading never changes the status, so the pre-read row is accurate.
  return { status: assertBriefStatus(brief.status) };
}
