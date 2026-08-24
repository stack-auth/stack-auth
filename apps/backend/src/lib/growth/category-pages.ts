import { Prisma } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import type { PrismaTransaction } from "@/lib/types";
import { PRISMA_ERROR_CODES, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { growthActionItemToWire, loadGrowthActionWorkflowRuntimeInfo } from "./actions";
import { toJsonInput } from "./agent-writes";
import { assertGrowthCategory, type GrowthCategory } from "./categories";
import { collectGrowthDocumentActionIds, collectStoredGrowthDocumentActionIds, compileGrowthDocument, type GrowthDocument } from "./content-document";

const MAX_ARCHIVED_VERSIONS = 10;

type GrowthCategoryPageRow = {
  id: string,
  category: string,
  version: number,
  status: string,
  sourceJson: unknown,
  document: unknown,
  sourceItemIds: unknown,
  authoredByUserId: string | null,
  publishedByUserId: string | null,
  publishedAt: Date | null,
  createdAt: Date,
  updatedAt: Date,
};

export type GrowthCategoryPageSourceItemIds = { findings: string[], actions: string[] };

function readSourceItemIds(value: unknown): GrowthCategoryPageSourceItemIds {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { findings: [], actions: [] };
  const readIds = (ids: unknown): string[] => Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  return {
    findings: readIds("findings" in value ? value.findings : null),
    actions: readIds("actions" in value ? value.actions : null),
  };
}

function versionToWire(row: GrowthCategoryPageRow) {
  return {
    id: row.id,
    category: row.category,
    version: row.version,
    status: row.status,
    source_json: row.sourceJson ?? null,
    document: row.document ?? null,
    source_item_ids: readSourceItemIds(row.sourceItemIds),
    published_at_millis: row.publishedAt == null ? null : row.publishedAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };
}

function versionSummaryToWire(row: GrowthCategoryPageRow) {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    published_at_millis: row.publishedAt == null ? null : row.publishedAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };
}

export async function getGrowthPublishedCategoryPages(tenancy: Tenancy) {
  const rows = await globalPrismaClient.growthCategoryPage.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, status: "published" },
    select: { category: true, version: true, document: true, publishedAt: true },
  });
  return rows.map((row) => ({
    category: row.category,
    version: row.version,
    document: row.document ?? null,
    published_at_millis: row.publishedAt == null ? null : row.publishedAt.getTime(),
    referenced_action_ids: collectStoredGrowthDocumentActionIds(row.document),
  }));
}

async function loadStaleSourceIds(
  tenancy: Tenancy,
  pages: { page: GrowthCategoryPageRow, sources: GrowthCategoryPageSourceItemIds }[],
): Promise<Map<string, string[]>> {
  const findingIds = [...new Set(pages.flatMap((entry) => entry.sources.findings))];
  const actionIds = [...new Set(pages.flatMap((entry) => entry.sources.actions))];
  const where = { projectId: tenancy.project.id, branchId: tenancy.branchId };
  const [findings, actions] = await Promise.all([
    findingIds.length === 0
      ? Promise.resolve([])
      : globalPrismaClient.growthFinding.findMany({ where: { ...where, id: { in: findingIds } }, select: { id: true, createdAt: true } }),
    actionIds.length === 0
      ? Promise.resolve([])
      : globalPrismaClient.growthActionItem.findMany({ where: { ...where, id: { in: actionIds } }, select: { id: true, updatedAt: true } }),
  ]);
  const changedAtById = new Map<string, Date>([
    ...findings.map((row): [string, Date] => [row.id, row.createdAt]),
    ...actions.map((row): [string, Date] => [row.id, row.updatedAt]),
  ]);

  const staleByPageId = new Map<string, string[]>();
  for (const entry of pages) {
    const stale: string[] = [];
    for (const id of [...entry.sources.findings, ...entry.sources.actions]) {
      const changedAt = changedAtById.get(id);
      if (changedAt == null || changedAt.getTime() > entry.page.updatedAt.getTime()) stale.push(id);
    }
    staleByPageId.set(entry.page.id, stale);
  }
  return staleByPageId;
}

export async function listGrowthAdminCategoryPages(tenancy: Tenancy) {
  const rows = await globalPrismaClient.growthCategoryPage.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ category: "asc" }, { version: "desc" }],
  });

  const editable = rows.filter((row) => row.status !== "archived");
  const [staleByPageId, referencedActionsById] = await Promise.all([
    loadStaleSourceIds(tenancy, editable.map((row) => ({ page: row, sources: readSourceItemIds(row.sourceItemIds) }))),
    loadReferencedActions(tenancy, editable),
  ]);

  const byCategory = new Map<string, { draft: GrowthCategoryPageRow | null, published: GrowthCategoryPageRow | null, archived: GrowthCategoryPageRow[] }>();
  for (const row of rows) {
    const entry = byCategory.get(row.category) ?? { draft: null, published: null, archived: [] };
    if (row.status === "draft") entry.draft = row;
    else if (row.status === "published") entry.published = row;
    else entry.archived.push(row);
    byCategory.set(row.category, entry);
  }

  const withStaleness = (row: GrowthCategoryPageRow | null) => row == null ? null : {
    ...versionToWire(row),
    stale_source_ids: staleByPageId.get(row.id) ?? [],
    actions: collectStoredGrowthDocumentActionIds(row.document).flatMap((id) => {
      const action = referencedActionsById.get(id);
      return action == null ? [] : [action];
    }),
  };

  return [...byCategory.entries()].map(([category, entry]) => ({
    category,
    draft: withStaleness(entry.draft),
    published: withStaleness(entry.published),
    archived: entry.archived.slice(0, MAX_ARCHIVED_VERSIONS).map(versionSummaryToWire),
  }));
}

async function loadReferencedActions(tenancy: Tenancy, rows: GrowthCategoryPageRow[]) {
  const actionIds = [...new Set(rows.flatMap((row) => collectStoredGrowthDocumentActionIds(row.document)))];
  if (actionIds.length === 0) return new Map<string, ReturnType<typeof growthActionItemToWire>>();
  const actions = await globalPrismaClient.growthActionItem.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, id: { in: actionIds } },
  });
  const workflowRuntimeByItemId = await loadGrowthActionWorkflowRuntimeInfo(tenancy, actions);
  return new Map(actions.map((item) => [item.id, growthActionItemToWire(item, workflowRuntimeByItemId.get(item.id) ?? null)]));
}

async function assertActionReferences(
  tx: PrismaTransaction,
  tenancy: Tenancy,
  category: GrowthCategory,
  document: GrowthDocument,
): Promise<void> {
  const actionIds = collectGrowthDocumentActionIds(document.blocks);
  if (actionIds.length === 0) return;
  const actions = await tx.growthActionItem.findMany({
    where: { id: { in: actionIds }, projectId: tenancy.project.id, branchId: tenancy.branchId },
    select: { id: true, category: true },
  });
  const byId = new Map(actions.map((action) => [action.id, action]));
  for (const actionId of actionIds) {
    const action = byId.get(actionId);
    if (action == null) throw new StatusError(400, `This page references an action that does not exist in this project: ${actionId}`);
    if (action.category !== category) throw new StatusError(400, `This page references an action from another stage: ${actionId}`);
  }
}

export async function saveGrowthAdminCategoryPageDraft(tenancy: Tenancy, input: {
  category: GrowthCategory,
  document: unknown,
  sourceItemIds: GrowthCategoryPageSourceItemIds,
  authoredByUserId: string,
  expectedDraftUpdatedAtMillis: number | null,
}) {
  const category = assertGrowthCategory(input.category);
  const compiled = compileGrowthDocument(input.document);

  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;
  const sourceItemIds = { findings: [...new Set(input.sourceItemIds.findings)], actions: [...new Set(input.sourceItemIds.actions)] };

  const saveDraft = () => retryTransaction(globalPrismaClient, async (tx) => {
    await assertActionReferences(tx, tenancy, category, compiled);

    const existingDraft = await tx.growthCategoryPage.findFirst({ where: { projectId, branchId, category, status: "draft" } });
    if (existingDraft != null) {
      if (input.expectedDraftUpdatedAtMillis !== existingDraft.updatedAt.getTime()) {
        throw new StatusError(409, "Someone else saved this stage's draft after you opened it. Reload the page to pick up their version before saving.");
      }
      const updated = await tx.growthCategoryPage.updateMany({
        where: { id: existingDraft.id, updatedAt: existingDraft.updatedAt },
        data: {
          sourceJson: toJsonInput(input.document),
          document: toJsonInput(compiled),
          sourceItemIds: toJsonInput(sourceItemIds),
          authoredByUserId: input.authoredByUserId,
        },
      });
      if (updated.count === 0) {
        throw new StatusError(409, "Someone else saved this stage's draft after you opened it. Reload the page to pick up their version before saving.");
      }
      return await tx.growthCategoryPage.findUniqueOrThrow({ where: { id: existingDraft.id } });
    }
    const latest = await tx.growthCategoryPage.findFirst({ where: { projectId, branchId, category }, orderBy: { version: "desc" }, select: { version: true } });
    return await tx.growthCategoryPage.create({
      data: {
        projectId,
        branchId,
        category,
        version: (latest?.version ?? 0) + 1,
        status: "draft",
        sourceJson: toJsonInput(input.document),
        document: toJsonInput(compiled),
        sourceItemIds: toJsonInput(sourceItemIds),
        authoredByUserId: input.authoredByUserId,
      },
    });
  });

  let row;
  try {
    row = await saveDraft();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_ERROR_CODES.UNIQUE_CONSTRAINT_VIOLATION) {
      throw new StatusError(409, "Someone else saved this stage's draft at the same time. Reload the page and try again.");
    }
    throw error;
  }

  return {
    ...versionToWire(row),
    stale_source_ids: [],
    actions: [...(await loadReferencedActions(tenancy, [row])).values()],
  };
}

export async function deleteGrowthAdminCategoryPageDraft(tenancy: Tenancy, category: GrowthCategory) {
  const result = await globalPrismaClient.growthCategoryPage.deleteMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, category: assertGrowthCategory(category), status: "draft" },
  });
  if (result.count === 0) throw new StatusError(404, "This stage has no draft to discard.");
  return { status: "deleted" };
}

export async function publishGrowthAdminCategoryPage(tenancy: Tenancy, input: { category: GrowthCategory, version: number, publishedByUserId: string }) {
  const category = assertGrowthCategory(input.category);
  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;

  const published = await retryTransaction(globalPrismaClient, async (tx) => {
    const target = await tx.growthCategoryPage.findFirst({ where: { projectId, branchId, category, version: input.version } });
    if (target == null) throw new StatusError(404, "This version of the stage page no longer exists.");
    if (target.status === "published") throw new StatusError(400, "This version is already live.");

    await assertActionReferences(tx, tenancy, category, compileGrowthDocument(target.sourceJson));

    const live = await tx.growthCategoryPage.findFirst({ where: { projectId, branchId, category, status: "published" } });
    if (live != null) await tx.growthCategoryPage.update({ where: { id: live.id }, data: { status: "archived" } });

    return await tx.growthCategoryPage.update({
      where: { id: target.id },
      data: { status: "published", publishedAt: new Date(), publishedByUserId: input.publishedByUserId },
    });
  });

  return versionToWire(published);
}

export async function unpublishGrowthAdminCategoryPage(tenancy: Tenancy, category: GrowthCategory) {
  const result = await globalPrismaClient.growthCategoryPage.updateMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, category: assertGrowthCategory(category), status: "published" },
    data: { status: "archived" },
  });
  if (result.count === 0) throw new StatusError(404, "This stage has no live page.");
  return { status: "unpublished" };
}
