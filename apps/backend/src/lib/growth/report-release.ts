import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient, retryTransaction } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import { getGrowthAdminReportBody } from "./actions";
import { lockGrowthReport, presentationToWire } from "./report-presentation";
import { assertTriggerIsValid } from "./phases";

export const PUBLISHED_GROWTH_REPORT_FILTER = { publishedAt: { not: null } };

/**
 * Whether this branch has ever had a report published, i.e. whether the workspace is unlocked.
 *
 * Deliberately "ever", not "its newest report is published": once a customer has been given a
 * report, a later analysis run that is still awaiting review must not take their workspace away
 * again. They keep the last published report and their insights while the new one is reviewed.
 */
export async function isGrowthWorkspaceReleased(tenancy: Tenancy): Promise<boolean> {
  const published = await globalPrismaClient.growthReport.findFirst({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, ...PUBLISHED_GROWTH_REPORT_FILTER },
    select: { id: true },
  });
  return published != null;
}

export async function requireGrowthWorkspaceReleased(tenancy: Tenancy): Promise<void> {
  if (!(await isGrowthWorkspaceReleased(tenancy))) {
    throw new StatusError(409, "Your growth report is still being prepared.");
  }
}

export const GROWTH_RELEASE_STATES = ["not_ready", "preparing", "released"] as const;
export type GrowthReleaseState = typeof GROWTH_RELEASE_STATES[number];

export function getGrowthReleaseState(options: {
  released: boolean,
  deepAnalysisStarted: boolean,
  analysisFailed: boolean,
}): GrowthReleaseState {
  if (options.released) return "released";
  if (options.analysisFailed || !options.deepAnalysisStarted) return "not_ready";
  return "preparing";
}

// ─── Staff ───────────────────────────────────────────────────────────────────

async function requireReportInTenancy(tenancy: Tenancy, reportId: string) {
  if (!isUuid(reportId)) throw new StatusError(404, "Report not found.");
  const report = await globalPrismaClient.growthReport.findFirst({
    where: { id: reportId, projectId: tenancy.project.id, branchId: tenancy.branchId },
    select: { id: true, publishedAt: true, publishedByUserId: true },
  });
  if (report == null) throw new StatusError(404, "Report not found.");
  return report;
}

/**
 * Every report this project has, newest first, with just enough to pick one to review. The report
 * bodies themselves are large and staff read one at a time, so they come from getGrowthAdminReport.
 */
export async function listGrowthAdminReports(tenancy: Tenancy) {
  const reports = await globalPrismaClient.growthReport.findMany({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      title: true,
      summary: true,
      createdAt: true,
      publishedAt: true,
      publishedByUserId: true,
      run: { select: { trigger: true } },
    },
  });
  // GrowthActionItem.reportId is a plain column, not a Prisma relation (an item outlives the report
  // that proposed it), so the count cannot ride along as a `_count` include — hence one grouped
  // query rather than one per report.
  const actionItemCounts = await globalPrismaClient.growthActionItem.groupBy({
    by: ["reportId"],
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId, reportId: { in: reports.map((report) => report.id) } },
    _count: true,
  });
  const actionItemCountByReportId = new Map(actionItemCounts.map((row) => [row.reportId, row._count]));
  return {
    reports: reports.map((report) => ({
      id: report.id,
      title: report.title,
      summary: report.summary,
      trigger: assertTriggerIsValid(report.run.trigger),
      action_item_count: actionItemCountByReportId.get(report.id) ?? 0,
      created_at_millis: report.createdAt.getTime(),
      published_at_millis: report.publishedAt == null ? null : report.publishedAt.getTime(),
      published_by_user_id: report.publishedByUserId,
    })),
  };
}

/**
 * One report in full for staff review, with the customer-facing report fields plus every authored
 * presentation version. Staff need the internal analysis artifact and source to choose what gets
 * published; this is intentionally no longer the customer wire shape.
 */
export async function getGrowthAdminReport(tenancy: Tenancy, reportId: string) {
  const report = await requireReportInTenancy(tenancy, reportId);
  const body = await getGrowthAdminReportBody(tenancy, report.id);
  const presentations = await globalPrismaClient.growthReportPresentation.findMany({
    where: { reportId: report.id, projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ version: "desc" }, { id: "desc" }],
    select: {
      id: true,
      reportId: true,
      format: true,
      tsxSource: true,
      actionItemIds: true,
      version: true,
      createdAt: true,
      createdByUserId: true,
      publishedAt: true,
      publishedByUserId: true,
    },
  });
  return {
    ...body,
    published_at_millis: report.publishedAt == null ? null : report.publishedAt.getTime(),
    published_by_user_id: report.publishedByUserId,
    presentations: presentations.map(presentationToWire),
  };
}

export async function unpublishGrowthReport(tenancy: Tenancy, reportId: string) {
  const report = await requireReportInTenancy(tenancy, reportId);
  if (report.publishedAt == null) throw new StatusError(409, "This report is not published.");
  await retryTransaction(globalPrismaClient, async (tx) => {
    await lockGrowthReport(tx, report.id);
    await tx.growthReportPresentation.updateMany({
      where: { reportId: report.id, publishedAt: { not: null } },
      data: { publishedAt: null, publishedByUserId: null },
    });
    await tx.growthReport.update({
      where: { id: report.id },
      data: { publishedAt: null, publishedByUserId: null },
    });
  });
  return await listGrowthAdminReports(tenancy);
}
