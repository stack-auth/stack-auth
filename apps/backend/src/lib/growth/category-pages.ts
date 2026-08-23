import { Prisma } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import type { PrismaTransaction } from "@/lib/types";
import { PRISMA_ERROR_CODES, globalPrismaClient, retryTransaction } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { growthActionItemToWire, loadGrowthActionWorkflowRuntimeInfo } from "./actions";
import { toJsonInput } from "./agent-writes";
import { assertGrowthCategory, type GrowthCategory } from "./categories";
import { collectGrowthDocumentActionIds, collectStoredGrowthDocumentActionIds, compileGrowthDocument, type GrowthDocument } from "./content-document";

/**
 * Stage pages: the staff-authored page a customer reads under a hexagon stage,
 * instead of that stage's raw findings/notes/actions.
 *
 * Two invariants shape everything here:
 *
 *   1. A customer only ever receives a PUBLISHED version's compiled document.
 *      Drafts, version history and the ids a page was written from are internal.
 *   2. An <ActionButton> in a page is a reference, resolved on write against the
 *      referencing project/branch/stage. The page carries no privilege: clicking
 *      the button goes through the ordinary action endpoints, which authorize the
 *      customer as they always did.
 */

/** Archived versions kept in the admin response — enough to roll back, bounded for the wire. */
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

/** A version stripped down to what a version list needs — no document payloads. */
function versionSummaryToWire(row: GrowthCategoryPageRow) {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    published_at_millis: row.publishedAt == null ? null : row.publishedAt.getTime(),
    updated_at_millis: row.updatedAt.getTime(),
  };
}

/**
 * The customer-facing read model: for each stage that has a live page, only its
 * compiled document. Deliberately NOT the draft, the version history, or the
 * source item ids — a customer has no business seeing an unfinished page or
 * learning which findings staff chose to leave out.
 */
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
    // The actions this page's <ActionButton>s point at. The overview's action lanes are capped and
    // active-only, so a page linking a completed action — or an older one past the cap — would
    // otherwise render as "no longer available" even though the action is right there in the project.
    referenced_action_ids: collectStoredGrowthDocumentActionIds(row.document),
  }));
}

/**
 * Which of a page's sources changed after the page was last saved.
 *
 * This is the whole reason `sourceItemIds` is stored: without it a page silently
 * ages out of date as the agent keeps writing, and staff have no way to know which
 * stage needs rewriting. Two queries total, regardless of how many stages have pages.
 */
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
      // GrowthFinding has no update timestamp (findings and notes are written once by the agent),
      // so for those the only detectable change is disappearing — hence createdAt, which for a source
      // the page already cites is always older than the page and therefore never flags on its own.
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
      // A deleted source counts as stale too: the page is quoting something that no
      // longer exists, which is exactly when staff need to look at it.
      if (changedAt == null || changedAt.getTime() > entry.page.updatedAt.getTime()) stale.push(id);
    }
    staleByPageId.set(entry.page.id, stale);
  }
  return staleByPageId;
}

/**
 * The admin read model: per stage, the editable draft, the live version, and a
 * bounded slice of the version history to roll back to.
 */
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
    // The version carries the actions its own <ActionButton>s point at, so the staff preview of a
    // draft resolves them exactly like the customer's copy of a live page would — including actions
    // the overview's capped, active-only lanes leave out.
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

/**
 * The action records the given versions' <ActionButton>s point at, for the staff preview.
 *
 * A page can reference an action the overview's capped lanes omit (completed, dismissed, or past
 * the cap), so resolving references against the overview alone would tell staff a perfectly valid
 * draft points at a suggestion that no longer exists.
 */
async function loadReferencedActions(tenancy: Tenancy, rows: GrowthCategoryPageRow[]) {
  const actionIds = [...new Set(rows.flatMap((row) => collectStoredGrowthDocumentActionIds(row.document)))];
  if (actionIds.length === 0) return new Map<string, ReturnType<typeof growthActionItemToWire>>();
  const actions = await globalPrismaClient.growthActionItem.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, id: { in: actionIds } },
  });
  const workflowRuntimeByItemId = await loadGrowthActionWorkflowRuntimeInfo(tenancy, actions);
  return new Map(actions.map((item) => [item.id, growthActionItemToWire(item, workflowRuntimeByItemId.get(item.id) ?? null)]));
}

/**
 * Resolves the actions a document references, refusing anything the page has no
 * business linking to.
 *
 * Same-stage only: a stage page argues about one stage, and a button that fires an
 * action belonging to a different part of the funnel is either a mistake or a way
 * to smuggle an unrelated action into a page a customer reads as being about
 * something else.
 */
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
    // The id is the staff-supplied part of the message, so it is safe to echo; it is
    // also the only way the author can tell which <ActionButton> to fix.
    if (action == null) throw new StatusError(400, `This page references an action that does not exist in this project: ${actionId}`);
    if (action.category !== category) throw new StatusError(400, `This page references an action from another stage: ${actionId}`);
  }
}

/**
 * Saves the stage's draft, compiling and validating the submitted payload first.
 *
 * Saving is also how previewing works: the admin page renders the stored draft
 * through the very component a customer would get, so a preview cannot diverge
 * from what publishing would show.
 */
export async function saveGrowthAdminCategoryPageDraft(tenancy: Tenancy, input: {
  category: GrowthCategory,
  document: unknown,
  sourceItemIds: GrowthCategoryPageSourceItemIds,
  authoredByUserId: string,
  /**
   * `updated_at_millis` of the draft the author started from, or null if they started from no
   * draft at all. There is only one draft slot per stage, so without this a second author editing
   * the same stage would silently overwrite a colleague's saved work; comparing it lets us reject
   * the save instead and let them reload.
   */
  expectedDraftUpdatedAtMillis: number | null,
}) {
  const category = assertGrowthCategory(input.category);
  const compiled = compileGrowthDocument(input.document);

  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;
  const sourceItemIds = { findings: [...new Set(input.sourceItemIds.findings)], actions: [...new Set(input.sourceItemIds.actions)] };

  const saveDraft = () => retryTransaction(globalPrismaClient, async (tx) => {
    // Inside the transaction so a concurrent recategorization/deletion of a
    // referenced action can't slip between the check and the write.
    await assertActionReferences(tx, tenancy, category, compiled);

    const existingDraft = await tx.growthCategoryPage.findFirst({ where: { projectId, branchId, category, status: "draft" } });
    if (existingDraft != null) {
      if (input.expectedDraftUpdatedAtMillis !== existingDraft.updatedAt.getTime()) {
        throw new StatusError(409, "Someone else saved this stage's draft after you opened it. Reload the page to pick up their version before saving.");
      }
      // The timestamp goes into the WHERE clause rather than only the check above, because the read
      // and the write are not one atomic step even inside a transaction: under READ COMMITTED two
      // overlapping saves can both read the same `updatedAt`, both pass the check, and the later one
      // silently replace the earlier author's text. As a predicate, the second writer blocks on the
      // first's row lock, re-evaluates against the now-bumped `updatedAt`, and matches nothing.
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
    // A new draft always takes the next version number, so version numbers are
    // never reused even after a rollback republished an older one.
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
    // Two authors creating the stage's first draft at the same time compute the same next version
    // number (or both aim for the single draft slot); the loser gets the same reload-and-retry
    // answer as the stale-overwrite case above rather than an opaque 500.
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

/**
 * Publishes a version: it becomes the one a customer sees, and whatever was live
 * is archived — in one transaction, because the database allows only one live
 * version per stage (GrowthCategoryPage_published_slot) and a half-done handover
 * would leave the stage either blank or showing two pages.
 *
 * Publishing an archived version is how rollback works; no new content is written,
 * so "roll back and then keep editing" leaves the draft untouched.
 */
export async function publishGrowthAdminCategoryPage(tenancy: Tenancy, input: { category: GrowthCategory, version: number, publishedByUserId: string }) {
  const category = assertGrowthCategory(input.category);
  const projectId = tenancy.project.id;
  const branchId = tenancy.branchId;

  const published = await retryTransaction(globalPrismaClient, async (tx) => {
    const target = await tx.growthCategoryPage.findFirst({ where: { projectId, branchId, category, version: input.version } });
    if (target == null) throw new StatusError(404, "This version of the stage page no longer exists.");
    if (target.status === "published") throw new StatusError(400, "This version is already live.");

    // Re-validate on the way out: the actions this page links to may have been
    // recategorized or deleted since the draft was written, and publishing is the
    // moment the references become customer-visible.
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

/**
 * Takes the stage's live page down. The stage falls back to the raw
 * findings/notes/actions lanes, which is also what a stage that never had a page
 * shows — so unpublishing is a safe undo rather than a hole in the workspace.
 */
export async function unpublishGrowthAdminCategoryPage(tenancy: Tenancy, category: GrowthCategory) {
  const result = await globalPrismaClient.growthCategoryPage.updateMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, category: assertGrowthCategory(category), status: "published" },
    data: { status: "archived" },
  });
  if (result.count === 0) throw new StatusError(404, "This stage has no live page.");
  return { status: "unpublished" };
}
