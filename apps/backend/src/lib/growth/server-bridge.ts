import { Prisma } from "@/generated/prisma/client";
import { resolveGrowthWatchedMetrics } from "@/lib/growth/agent-writes";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { assertGrowthCategory, normalizeGrowthTags, type GrowthCategory } from "./categories";

/**
 * Write-side logic behind `internal/growth-server/findings` and `internal/growth-server/action-items`
 * — the *ordinary server-auth* bridge that lets a customer's own scheduled Workflow file findings or
 * propose a follow-up action item ("CPA drifted, consider raising the bid"). This is a DIFFERENT
 * trust boundary from agent-writes.ts: that file backs routes authenticated by Hexclave's single
 * shared growth-agent secret (one runtime, every project), where `source` is drawn from a closed set
 * of known phase keys (see isValidGrowthFindingSource). Here the caller is "any holder of this
 * project's own server API key" — routinely a Workflow the CUSTOMER wrote — so `source` is instead
 * an arbitrary customer-chosen workflow id, and the write surface is deliberately narrower: no run
 * association, no agent-authored workflow, and action items are pinned to `typeId: "custom"` by the
 * route's yup schema (see action-items/route.tsx) so this file never has to reason about `run_ads`
 * or any other executor with a real-world side effect.
 */

// A daily monitor is expected to fire roughly once every 24h; 36h gives it slack for cron jitter or a
// timezone-adjacent double-fire while still catching "the condition is still true tomorrow" as a
// distinct, dedupe-eligible event rather than a duplicate of today's.
export const GROWTH_SERVER_ACTION_ITEM_DEDUPE_WINDOW_MS = 36 * 60 * 60 * 1000;

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}

const MAX_WORKFLOW_ID_LENGTH = 200;

/**
 * The only validation applied to the caller-supplied workflow id: it becomes `GrowthFinding.source`
 * / is embedded in `GrowthActionItem.payload` verbatim, so it must be non-empty and bounded, but
 * (unlike agent-writes.ts's `isValidGrowthFindingSource`) it is NOT checked against a closed set —
 * customer workflow ids are exactly as arbitrary as the customer's own Workflow product lets them be.
 */
export function assertGrowthServerWorkflowId(workflowId: string): string {
  if (workflowId.length === 0 || workflowId.length > MAX_WORKFLOW_ID_LENGTH) {
    throw new StatusError(400, `workflow_id must be between 1 and ${MAX_WORKFLOW_ID_LENGTH} characters.`);
  }
  return workflowId;
}

export async function createGrowthServerFindings(options: {
  tenancy: Tenancy,
  workflowId: string,
  findings: { kind: string, category: GrowthCategory, tags: string[], title: string, body: string, data: unknown | undefined }[],
}): Promise<{ createdCount: number, skippedCount: number }> {
  const source = assertGrowthServerWorkflowId(options.workflowId);
  return await retryTransaction(globalPrismaClient, async (tx) => {
    let createdCount = 0;
    let skippedCount = 0;
    for (const finding of options.findings) {
      // Same (source, kind, title) dedup shape as agent-writes.ts's createGrowthFindings, scoped to
      // runId=null: server-bridge findings are never attached to an analysis run, so there is only
      // ever one "no run" bucket per (source, kind, title) to collide against.
      const existing = await tx.growthFinding.findFirst({
        where: {
          projectId: options.tenancy.project.id,
          branchId: options.tenancy.branchId,
          runId: null,
          source,
          kind: finding.kind,
          title: finding.title,
        },
        select: { id: true },
      });
      if (existing != null) {
        skippedCount++;
        continue;
      }
      await tx.growthFinding.create({
        data: {
          projectId: options.tenancy.project.id,
          branchId: options.tenancy.branchId,
          runId: undefined,
          source,
          kind: finding.kind,
          category: assertGrowthCategory(finding.category),
          tags: normalizeGrowthTags(finding.tags),
          title: finding.title,
          body: finding.body,
          data: finding.data === undefined ? undefined : toJsonInput(finding.data),
        },
      });
      createdCount++;
    }
    return { createdCount, skippedCount };
  });
}

export type GrowthServerActionItemInput = {
  category: GrowthCategory,
  tags: string[],
  title: string,
  description: string,
  payload: unknown | undefined,
  watchedMetrics: { metric_id: string, window_days: number }[] | undefined,
  dedupeKey: string,
};

/**
 * Creates a `typeId: "custom"` action item, no-opping (returning the existing id) when a
 * non-dismissed item with the same `dedupe_key` was created inside the dedupe window. This is the
 * fix for the specific failure mode a daily monitor produces without it: a condition that stays true
 * for a week files seven near-identical action items and buries the real ones.
 *
 * `GrowthActionItem` has no dedicated dedupe-key column (that would be a schema migration this
 * bridge chunk doesn't own), so `dedupe_key` and the caller's workflow id are stored as reserved
 * top-level keys inside the JSON `payload` — `dedupe_key` and `source` — and queried back with a
 * Postgres JSON-path filter, the same technique plan-usage.ts uses for `team_id`. Because `typeId` is
 * always "custom" here, `payload` is otherwise freeform, so this doesn't collide with any structured
 * payload another code path depends on (contrast `run_ads`, whose `payload.ad_campaign` shape is a
 * frozen contract this route never touches). A caller-supplied payload that itself uses the
 * `dedupe_key`/`source` keys has those keys overwritten — acceptable since this route already forces
 * `dedupe_key` to come from the dedicated body field, not from `payload`.
 */
export async function createGrowthServerActionItem(options: {
  tenancy: Tenancy,
  workflowId: string,
  item: GrowthServerActionItemInput,
}): Promise<{ actionItemId: string, deduped: boolean }> {
  const source = assertGrowthServerWorkflowId(options.workflowId);
  if (options.item.dedupeKey.length === 0 || options.item.dedupeKey.length > 200) {
    throw new StatusError(400, "dedupe_key must be between 1 and 200 characters.");
  }
  const watchedMetrics = resolveGrowthWatchedMetrics("custom", options.item.watchedMetrics);
  const windowStart = new Date(Date.now() - GROWTH_SERVER_ACTION_ITEM_DEDUPE_WINDOW_MS);

  return await retryTransaction(globalPrismaClient, async (tx) => {
    const existing = await tx.growthActionItem.findFirst({
      where: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
        typeId: "custom",
        status: { not: "dismissed" },
        createdAt: { gte: windowStart },
        payload: { path: ["dedupe_key"], equals: options.item.dedupeKey },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (existing != null) {
      return { actionItemId: existing.id, deduped: true };
    }
    const payloadRecord = options.item.payload != null && typeof options.item.payload === "object" && !Array.isArray(options.item.payload)
      ? options.item.payload as Record<string, unknown>
      : {};
    const created = await tx.growthActionItem.create({
      data: {
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
        typeId: "custom",
        category: assertGrowthCategory(options.item.category),
        tags: normalizeGrowthTags(options.item.tags),
        title: options.item.title,
        description: options.item.description,
        payload: toJsonInput({ ...payloadRecord, dedupe_key: options.item.dedupeKey, source }),
        watchedMetrics: toJsonInput(watchedMetrics),
        // workflowId/workflowSource/etc all stay null: growth-server callers may never author an
        // agent-authored automation (that would be an automation authoring another automation,
        // recursively, unreviewed) — the route's yup schema doesn't even accept a `workflow` field,
        // this is just the write-side half of that same invariant.
      },
      select: { id: true },
    });
    return { actionItemId: created.id, deduped: false };
  });
}
