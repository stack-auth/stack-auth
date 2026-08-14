import type { Tenancy } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";
import { getGrowthReportBody } from "./actions";
import { assertTriggerIsValid } from "./phases";

/**
 * The release gate: a growth report is written by the `report` phase, but no customer sees it until
 * a Hexclave staff member has read it and published it.
 *
 * This module is the ONLY place allowed to decide what "released" means. Everything else asks it —
 * the customer routes through `requireGrowthWorkspaceReleased`, the status wire through
 * `getGrowthReleaseState`. That matters because the gate is enforced in a dozen route files, and a
 * second definition drifting out of step with this one would not fail loudly; it would just quietly
 * hand somebody a report nobody had read.
 *
 * The staff half lives here too, so that "what publishing does" and "what publishing gates" are
 * legible in one file. Like quiz-games.ts, nothing in this module authorizes anything: every
 * function takes an already-resolved `Tenancy` for the TARGET project, and resolving it — plus
 * checking the caller is a platform admin — is `requireGrowthAdminTenancy` in ./admin.ts, at the
 * route boundary.
 */

/**
 * What a customer may read. Unpublished reports are not "hidden from the response" — as far as
 * every customer-facing query is concerned they do not exist, which is why this is a `where`
 * fragment rather than a field the wire mappers remember to strip.
 */
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

/**
 * Guard for the customer routes that are dark until the first report is published. Sits directly
 * under `requireGrowthAppEnabled` in every locked handler.
 *
 * The message says nothing about staff review on purpose: to the customer the report is being
 * prepared, and that is all this build promises them. 409 rather than 403 because nothing about the
 * caller is wrong — the workspace is simply not in a state that can answer yet, and it will be.
 *
 * What is locked, and why these and not others:
 *   overview, metrics-overview  the insights, the journey stepper, the category scores
 *   briefs/**                   a daily brief summarizes findings the report has not revealed yet
 *   actions/**                  "suggestions" ARE proposed action items
 *   chat/**                     the assistant answers from full growth context
 * What stays open, because the customer needs it to GET to a report at all: status, onboarding,
 * runs/**, analysis/retry, interview/**, milestones/**, workflows/restore. reports/[report_id] is
 * gated too, but by the published-only lookup rather than by this guard — see getGrowthReportBody.
 */
export async function requireGrowthWorkspaceReleased(tenancy: Tenancy): Promise<void> {
  if (!(await isGrowthWorkspaceReleased(tenancy))) {
    throw new StatusError(409, "Your growth report is still being prepared.");
  }
}

export const GROWTH_RELEASE_STATES = ["not_ready", "preparing", "released"] as const;
export type GrowthReleaseState = typeof GROWTH_RELEASE_STATES[number];

/**
 * The single release signal on the status wire, which the dashboard uses to decide between the
 * "come back in about 24 hours" hold and the live workspace.
 *
 * `preparing` deliberately covers BOTH "the report phase is still composing" and "written, waiting
 * for a human to publish it". The customer cannot tell those apart and should not be able to: the
 * copy they see is the same either way, and a wire value named after the review step would announce
 * in devtools something the product does not say out loud.
 *
 * `not_ready` is everything before that — no onboarding, no run, a failed run, or an interview still
 * outstanding. The timeline is already showing an earlier step in those cases, so the hold copy
 * would be premature.
 */
export function getGrowthReleaseState(options: {
  released: boolean,
  interviewSettled: boolean,
  analysisFailed: boolean,
}): GrowthReleaseState {
  if (options.released) return "released";
  if (options.analysisFailed || !options.interviewSettled) return "not_ready";
  return "preparing";
}

// ─── Staff ───────────────────────────────────────────────────────────────────

async function requireReportInTenancy(tenancy: Tenancy, reportId: string) {
  // A non-UUID id can never match a row, but Prisma would turn it into a Postgres cast error (a
  // 500) instead of a clean miss — so pre-check and 404 early. Same 404 whether the report does not
  // exist or belongs to another project, so ids from other projects cannot be probed.
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

/**
 * Releases a reviewed report to the customer.
 *
 * A plain single-row update, with none of the archive-the-incumbent dance publishQuizGame needs:
 * publishing report N does not invalidate report N−1, because a branch accumulates published
 * reports over its lifetime and that history is the point. The customer's "latest report" is simply
 * the newest published row.
 */
export async function publishGrowthReport(tenancy: Tenancy, reportId: string, options: {
  publishedByUserId: string | null,
  now: Date,
}) {
  const report = await requireReportInTenancy(tenancy, reportId);
  if (report.publishedAt != null) throw new StatusError(409, "This report is already published.");
  await globalPrismaClient.growthReport.update({
    where: { id: report.id },
    data: { publishedAt: options.now, publishedByUserId: options.publishedByUserId },
  });
  return await listGrowthAdminReports(tenancy);
}

/**
 * Takes a published report back out of the customer's hands.
 *
 * This exists for staff error recovery — publishing against the wrong project is the realistic
 * mistake, and there has to be a way back from it. It is not part of any customer-facing lifecycle,
 * and it does not pretend the report was never read: `publishedByUserId` is cleared alongside
 * `publishedAt` so the row stops claiming an approval that has been withdrawn.
 */
export async function unpublishGrowthReport(tenancy: Tenancy, reportId: string) {
  const report = await requireReportInTenancy(tenancy, reportId);
  if (report.publishedAt == null) throw new StatusError(409, "This report is not published.");
  await globalPrismaClient.growthReport.update({
    where: { id: report.id },
    data: { publishedAt: null, publishedByUserId: null },
  });
  return await listGrowthAdminReports(tenancy);
}
