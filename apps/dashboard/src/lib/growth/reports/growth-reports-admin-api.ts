import { z } from "zod";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { mapGrowthReport, reportSchema, requestGrowthAdminJson } from "../growth-api";
import { GROWTH_RUN_TRIGGERS, type GrowthReport, type GrowthRunTrigger } from "../growth-types";

/**
 * Staff fetchers for the Growth admin Reports card — reviewing a report and releasing it to the
 * customer. Mirrors games/growth-games-admin-api.ts: zod-parse the snake_case wire, map to camel,
 * and let every mutation return the whole list so the card replaces its state from one authoritative
 * snapshot rather than patching a row it guessed at.
 *
 * The list and the detail are separate calls on purpose. A report document is long, and staff read
 * one at a time — shipping every report's full body just to render a list of titles would make
 * opening the admin page proportional to how many analyses the project has ever run.
 */

const summarySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  trigger: z.enum(GROWTH_RUN_TRIGGERS),
  action_item_count: z.number(),
  created_at_millis: z.number(),
  published_at_millis: z.number().nullable(),
  published_by_user_id: z.string().nullable(),
});

const listSchema = z.object({ reports: z.array(summarySchema) });

// The customer's report body plus the one field only staff see.
const detailSchema = reportSchema.extend({ published_at_millis: z.number().nullable() });

export type GrowthAdminReportSummary = {
  id: string,
  title: string,
  summary: string,
  trigger: GrowthRunTrigger,
  actionItemCount: number,
  createdAtMillis: number,
  /** null means held: written, but not released to the customer. */
  publishedAtMillis: number | null,
  publishedByUserId: string | null,
};

export type GrowthAdminReportsBody = { reports: GrowthAdminReportSummary[] };

export type GrowthAdminReportDetail = GrowthReport & { publishedAtMillis: number | null };

function mapList(value: z.infer<typeof listSchema>): GrowthAdminReportsBody {
  return {
    reports: value.reports.map((report) => ({
      id: report.id,
      title: report.title,
      summary: report.summary,
      trigger: report.trigger,
      actionItemCount: report.action_item_count,
      createdAtMillis: report.created_at_millis,
      publishedAtMillis: report.published_at_millis,
      publishedByUserId: report.published_by_user_id,
    })),
  };
}

async function listBody(promise: Promise<unknown>): Promise<GrowthAdminReportsBody> {
  return mapList(listSchema.parse(await promise));
}

export async function getGrowthAdminReports(app: object, projectId: string): Promise<GrowthAdminReportsBody> {
  return await listBody(requestGrowthAdminJson(app, urlString`/reports?project_id=${projectId}`));
}

export async function getGrowthAdminReport(app: object, projectId: string, reportId: string): Promise<GrowthAdminReportDetail> {
  const parsed = detailSchema.parse(await requestGrowthAdminJson(app, urlString`/reports/${reportId}?project_id=${projectId}`));
  return { ...mapGrowthReport(parsed), publishedAtMillis: parsed.published_at_millis };
}

export async function publishGrowthAdminReport(app: object, projectId: string, reportId: string): Promise<GrowthAdminReportsBody> {
  return await listBody(requestGrowthAdminJson(app, urlString`/reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "publish" }),
  }));
}

export async function unpublishGrowthAdminReport(app: object, projectId: string, reportId: string): Promise<GrowthAdminReportsBody> {
  return await listBody(requestGrowthAdminJson(app, urlString`/reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "unpublish" }),
  }));
}
