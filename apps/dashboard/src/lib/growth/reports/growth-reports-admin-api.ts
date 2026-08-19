import { z } from "zod";
import { urlString } from "@hexclave/shared/dist/utils/urls";
import { actionItemSchema, mapGrowthActionItem, requestGrowthAdminJson } from "../growth-api";
import { growthDocumentSchema } from "../growth-document";
import { GROWTH_RUN_TRIGGERS, type GrowthAdminReport, type GrowthReportPresentation, type GrowthRunTrigger } from "../growth-types";

/**
 * Staff fetchers for the Growth admin Reports card — reading the internal analysis artifact,
 * authoring presentation versions, and explicitly publishing or unpublishing one version.
 * Mirrors games/growth-games-admin-api.ts: zod-parse the snake_case wire, map to camel, and let
 * every mutation return an authoritative snapshot rather than patching guessed local state.
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

const presentationSchema = z.object({
  id: z.string(),
  report_id: z.string(),
  format: z.string(),
  tsx_source: z.string(),
  action_item_ids: z.array(z.string()),
  version: z.number().int(),
  created_at_millis: z.number(),
  created_by_user_id: z.string().nullable(),
  published_at_millis: z.number().nullable(),
  published_by_user_id: z.string().nullable(),
});

const presentationListSchema = z.object({ presentations: z.array(presentationSchema) });

const adminDetailSchema = z.object({
  id: z.string(),
  run_id: z.string(),
  title: z.string(),
  summary: z.string(),
  created_at_millis: z.number(),
  action_items: z.array(actionItemSchema),
  content_md: z.string(),
  document: growthDocumentSchema.nullable().optional(),
  sections: z.array(z.object({
    id: z.string().nullish(),
    kind: z.string(),
    title: z.string(),
    body_markdown: z.string(),
  })).nullable(),
  published_at_millis: z.number().nullable(),
  presentations: z.array(presentationSchema),
});

export type GrowthAdminReportSummary = {
  id: string,
  title: string,
  summary: string,
  trigger: GrowthRunTrigger,
  actionItemCount: number,
  createdAtMillis: number,
  /** null means pulled: staff unpublished it, so the customer can no longer read it. */
  publishedAtMillis: number | null,
  publishedByUserId: string | null,
};

export type GrowthAdminReportsBody = { reports: GrowthAdminReportSummary[] };

export type GrowthAdminReportDetail = GrowthAdminReport;

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
  const parsed = adminDetailSchema.parse(await requestGrowthAdminJson(app, urlString`/reports/${reportId}?project_id=${projectId}`));
  return {
    id: parsed.id,
    runId: parsed.run_id,
    title: parsed.title,
    summary: parsed.summary,
    content: {
      contentMd: parsed.content_md,
      document: parsed.document ?? null,
      sections: parsed.sections == null ? null : parsed.sections.map((section) => ({
        id: section.id ?? null,
        kind: section.kind,
        title: section.title,
        bodyMd: section.body_markdown,
      })),
    },
    createdAtMillis: parsed.created_at_millis,
    actionItems: parsed.action_items.map(mapGrowthActionItem),
    publishedAtMillis: parsed.published_at_millis,
    presentations: parsed.presentations.map(mapPresentation),
  };
}

export async function unpublishGrowthAdminReport(app: object, projectId: string, reportId: string): Promise<GrowthAdminReportsBody> {
  return await listBody(requestGrowthAdminJson(app, urlString`/reports/${reportId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "unpublish" }),
  }));
}

function mapPresentation(value: z.infer<typeof presentationSchema>): GrowthReportPresentation {
  return {
    id: value.id,
    reportId: value.report_id,
    format: value.format,
    tsxSource: value.tsx_source,
    actionItemIds: value.action_item_ids,
    version: value.version,
    createdAtMillis: value.created_at_millis,
    createdByUserId: value.created_by_user_id,
    publishedAtMillis: value.published_at_millis,
    publishedByUserId: value.published_by_user_id,
  };
}

async function presentationList(promise: Promise<unknown>): Promise<GrowthReportPresentation[]> {
  return presentationListSchema.parse(await promise).presentations.map(mapPresentation);
}

async function presentationSnapshot(promise: Promise<unknown>): Promise<GrowthReportPresentation> {
  return mapPresentation(presentationSchema.parse(await promise));
}

export async function getGrowthAdminReportPresentations(app: object, projectId: string, reportId: string): Promise<GrowthReportPresentation[]> {
  return await presentationList(requestGrowthAdminJson(app, urlString`/reports/${reportId}/presentations?project_id=${projectId}`));
}

export async function createGrowthAdminReportPresentation(app: object, projectId: string, reportId: string, input: {
  format: string,
  tsxSource: string,
  actionItemIds: string[],
}): Promise<GrowthReportPresentation> {
  return await presentationSnapshot(requestGrowthAdminJson(app, urlString`/reports/${reportId}/presentations`, {
    method: "POST",
    body: JSON.stringify({
      target_project_id: projectId,
      format: input.format,
      tsx_source: input.tsxSource,
      action_item_ids: input.actionItemIds,
    }),
  }));
}

export async function publishGrowthAdminReportPresentation(app: object, projectId: string, reportId: string, presentationId: string): Promise<GrowthReportPresentation> {
  return await presentationSnapshot(requestGrowthAdminJson(app, urlString`/reports/${reportId}/presentations/${presentationId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "publish" }),
  }));
}

export async function unpublishGrowthAdminReportPresentation(app: object, projectId: string, reportId: string, presentationId: string): Promise<GrowthReportPresentation> {
  return await presentationSnapshot(requestGrowthAdminJson(app, urlString`/reports/${reportId}/presentations/${presentationId}`, {
    method: "PATCH",
    body: JSON.stringify({ target_project_id: projectId, action: "unpublish" }),
  }));
}
