import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import { getGrowthReportBody } from "./actions";
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
    select: { id: true, publishedAt: true },
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
 * One report in full, exactly as the customer would receive it — same function, same wire shape,
 * only with the published-only filter lifted. A reviewer has to be looking at the real artefact; a
 * staff-only rendering of it would be a different thing than the one being approved.
 */
export async function getGrowthAdminReport(tenancy: Tenancy, reportId: string) {
  const report = await requireReportInTenancy(tenancy, reportId);
  const body = await getGrowthReportBody(tenancy, report.id, { publishedOnly: false });
  return { ...body, published_at_millis: report.publishedAt == null ? null : report.publishedAt.getTime() };
}

export async function unpublishGrowthReport(tenancy: Tenancy, reportId: string) {
  const report = await requireReportInTenancy(tenancy, reportId);
  if (report.publishedAt == null) throw new StatusError(409, "This report is not published.");
  await globalPrismaClient.growthReport.update({
    where: { id: report.id },
    data: { publishedAt: null, publishedByUserId: null },
  });
  return await listGrowthAdminReports(tenancy);
}
