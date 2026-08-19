import { Prisma } from "@/generated/prisma/client";
import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, PrismaClientTransaction, retryTransaction } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";

export const GROWTH_REPORT_PRESENTATION_FORMAT = "sandboxed-tsx-v1";
export const GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES = 512 * 1024;

export type GrowthReportPresentationSnapshot = {
  id: string,
  report_id: string,
  format: string,
  tsx_source: string,
  action_item_ids: string[],
  version: number,
  created_at_millis: number,
  created_by_user_id: string | null,
  published_at_millis: number | null,
  published_by_user_id: string | null,
};

export function presentationToWire(presentation: {
  id: string,
  reportId: string,
  format: string,
  tsxSource: string,
  actionItemIds: string[],
  version: number,
  createdAt: Date,
  createdByUserId: string | null,
  publishedAt: Date | null,
  publishedByUserId: string | null,
}): GrowthReportPresentationSnapshot {
  return {
    id: presentation.id,
    report_id: presentation.reportId,
    format: presentation.format,
    tsx_source: presentation.tsxSource,
    action_item_ids: presentation.actionItemIds,
    version: presentation.version,
    created_at_millis: presentation.createdAt.getTime(),
    created_by_user_id: presentation.createdByUserId,
    published_at_millis: presentation.publishedAt?.getTime() ?? null,
    published_by_user_id: presentation.publishedByUserId,
  };
}

/**
 * JSX/TSX cannot be compiled server-side because the customer iframe transpiles it with Babel.
 * Keep the structural checks here; the sandbox performs the real compilation, and the admin
 * preview will surface broken source before staff publishes it.
 */
export function validateGrowthReportPresentationSource(source: string): void {
  if (source.trim().length === 0) {
    throw new StatusError(400, "Presentation source must not be empty.");
  }
  if (Buffer.byteLength(source, "utf8") > GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES) {
    throw new StatusError(400, `Presentation source must be at most ${GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES} bytes.`);
  }
  if (!/(?:const|let|var|function|class)\s+Dashboard\b/.test(source)) {
    throw new StatusError(400, "Presentation source must define a top-level Dashboard component.");
  }
}

function requireReportId(reportId: string): string {
  if (!isUuid(reportId)) throw new StatusError(404, "Report not found.");
  return reportId;
}

export async function lockGrowthReport(tx: PrismaClientTransaction, reportId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id"::text AS "id"
    FROM "GrowthReport"
    WHERE "id" = ${reportId}::uuid
    FOR UPDATE
  `);
  if (rows.length === 0) throw new StatusError(404, "Report not found.");
}

async function requirePresentationInTenancy(tx: PrismaClientTransaction, tenancy: Tenancy, presentationId: string, reportId?: string) {
  if (!isUuid(presentationId)) throw new StatusError(404, "Presentation not found.");
  const presentation = await tx.growthReportPresentation.findFirst({
    where: {
      id: presentationId,
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      ...(reportId == null ? {} : { reportId }),
    },
  });
  if (presentation == null) throw new StatusError(404, "Presentation not found.");
  return presentation;
}

export async function listGrowthReportPresentations(tenancy: Tenancy, reportId: string) {
  const id = requireReportId(reportId);
  const report = await globalPrismaClient.$replica().growthReport.findFirst({
    where: { id, projectId: tenancy.project.id, branchId: tenancy.branchId },
    select: { id: true },
  });
  if (report == null) throw new StatusError(404, "Report not found.");
  const presentations = await globalPrismaClient.$replica().growthReportPresentation.findMany({
    where: { reportId: id, projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ version: "desc" }, { id: "desc" }],
  });
  return { presentations: presentations.map(presentationToWire) };
}

export async function createGrowthReportPresentation(options: {
  tenancy: Tenancy,
  reportId: string,
  format: string,
  tsxSource: string,
  actionItemIds: string[],
  createdByUserId: string | null,
}) {
  const reportId = requireReportId(options.reportId);
  if (options.format !== GROWTH_REPORT_PRESENTATION_FORMAT) {
    throw new StatusError(400, `Unsupported presentation format. Use ${GROWTH_REPORT_PRESENTATION_FORMAT}.`);
  }
  validateGrowthReportPresentationSource(options.tsxSource);
  if (new Set(options.actionItemIds).size !== options.actionItemIds.length) {
    throw new StatusError(400, "action_item_ids must not contain duplicates.");
  }
  if (options.actionItemIds.some((id) => !isUuid(id))) {
    throw new StatusError(400, "action_item_ids must contain valid action item ids.");
  }

  const created = await retryTransaction(globalPrismaClient, async (tx) => {
    await lockGrowthReport(tx, reportId);
    const report = await tx.growthReport.findFirst({
      where: { id: reportId, projectId: options.tenancy.project.id, branchId: options.tenancy.branchId },
      select: { id: true },
    });
    if (report == null) throw new StatusError(404, "Report not found.");

    const actionItems = await tx.growthActionItem.findMany({
      where: {
        id: { in: options.actionItemIds },
        reportId,
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
      },
      select: { id: true },
    });
    const existingIds = new Set(actionItems.map((item) => item.id));
    const invalidId = options.actionItemIds.find((id) => !existingIds.has(id));
    if (invalidId != null) {
      throw new StatusError(400, "Every action_item_id must belong to this report.");
    }

    const latest = await tx.growthReportPresentation.findFirst({
      where: { reportId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return await tx.growthReportPresentation.create({
      data: {
        reportId,
        projectId: options.tenancy.project.id,
        branchId: options.tenancy.branchId,
        format: options.format,
        tsxSource: options.tsxSource,
        actionItemIds: options.actionItemIds,
        version: (latest?.version ?? 0) + 1,
        createdByUserId: options.createdByUserId,
      },
    });
  });
  return presentationToWire(created);
}

export async function getGrowthReportPresentation(tenancy: Tenancy, presentationId: string) {
  if (!isUuid(presentationId)) throw new StatusError(404, "Presentation not found.");
  const presentation = await globalPrismaClient.growthReportPresentation.findFirst({
    where: { id: presentationId, projectId: tenancy.project.id, branchId: tenancy.branchId },
  });
  if (presentation == null) throw new StatusError(404, "Presentation not found.");
  return presentationToWire(presentation);
}

export async function publishGrowthReportPresentation(options: {
  tenancy: Tenancy,
  reportId: string,
  presentationId: string,
  publishedByUserId: string | null,
}) {
  const presentationId = options.presentationId;
  if (!isUuid(presentationId)) throw new StatusError(404, "Presentation not found.");
  const now = new Date();
  await retryTransaction(globalPrismaClient, async (tx) => {
    const presentation = await requirePresentationInTenancy(tx, options.tenancy, presentationId, options.reportId);
    await lockGrowthReport(tx, presentation.reportId);
    await tx.growthReportPresentation.updateMany({
      where: { reportId: presentation.reportId, publishedAt: { not: null } },
      data: { publishedAt: null, publishedByUserId: null },
    });
    await tx.growthReportPresentation.update({
      where: { id: presentation.id },
      data: { publishedAt: now, publishedByUserId: options.publishedByUserId },
    });
    await tx.growthReport.update({
      where: { id: presentation.reportId },
      data: { publishedAt: now, publishedByUserId: options.publishedByUserId },
    });
  });
  return await getGrowthReportPresentation(options.tenancy, presentationId);
}

export async function unpublishGrowthReportPresentation(options: { tenancy: Tenancy, reportId: string, presentationId: string }) {
  if (!isUuid(options.presentationId)) throw new StatusError(404, "Presentation not found.");
  await retryTransaction(globalPrismaClient, async (tx) => {
    const presentation = await requirePresentationInTenancy(tx, options.tenancy, options.presentationId, options.reportId);
    await lockGrowthReport(tx, presentation.reportId);
    const unpublished = await tx.growthReportPresentation.updateMany({
      where: { id: presentation.id, publishedAt: { not: null } },
      data: { publishedAt: null, publishedByUserId: null },
    });
    if (unpublished.count === 0) throw new StatusError(409, "This presentation is not published.");
    await tx.growthReport.update({
      where: { id: presentation.reportId },
      data: { publishedAt: null, publishedByUserId: null },
    });
  });
  return await getGrowthReportPresentation(options.tenancy, options.presentationId);
}
