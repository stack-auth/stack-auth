"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { cn } from "@/components/ui";
import { formatGrowthRelativeTime } from "@/lib/growth/growth-format";
import {
  getGrowthAdminReport,
  getGrowthAdminReports,
  unpublishGrowthAdminReport,
  type GrowthAdminReportDetail,
  type GrowthAdminReportsBody,
  type GrowthAdminReportSummary,
} from "@/lib/growth/reports/growth-reports-admin-api";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { FileTextIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { GrowthActionCard } from "../components/action-card";
import { GrowthDocumentRenderer } from "../components/growth-document";
import { GrowthReportSections } from "../components/report-sections";
import { PresentationEditor } from "./presentation-editor";

type ListState =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", body: GrowthAdminReportsBody };

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", report: GrowthAdminReportDetail };

function ReportRow(props: {
  report: GrowthAdminReportSummary,
  selected: boolean,
  nowMillis: number,
  onSelect: () => void,
}) {
  const { report } = props;
  // "pulled" rather than "held": a report with no publish timestamp is one staff took back, since
  // nothing writes a report unpublished any more.
  const pulled = report.publishedAtMillis == null;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "w-full rounded-xl border px-3 py-2 text-left transition-colors hover:transition-none",
        props.selected ? "border-foreground/25 bg-foreground/[0.04]" : "border-foreground/[0.09] hover:bg-foreground/[0.02]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DesignBadge label={pulled ? "pulled" : "live"} color={pulled ? "orange" : "green"} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{report.title}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{report.trigger}</span>
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{report.summary}</p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        written {formatGrowthRelativeTime(report.createdAtMillis, props.nowMillis)}
        {" · "}{report.actionItemCount} {report.actionItemCount === 1 ? "action" : "actions"}
        {report.publishedAtMillis != null && <> · published {formatGrowthRelativeTime(report.publishedAtMillis, props.nowMillis)}</>}
      </p>
    </button>
  );
}

/** The internal analysis artifact staff use while authoring the customer presentation. */
function ReportPreview(props: { report: GrowthAdminReportDetail }) {
  const { report } = props;
  return (
    <div className="flex flex-col gap-6 rounded-xl border border-foreground/[0.09] p-4">
      <header>
        <h3 className="text-lg font-semibold tracking-tight">{report.title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{report.summary}</p>
      </header>
      {report.content.document == null ? (
        <GrowthReportSections contentMd={report.content.contentMd} sections={report.content.sections} />
      ) : (
        <GrowthDocumentRenderer document={report.content.document} />
      )}
      {report.actionItems.length > 0 && (
        <section className="border-t border-foreground/[0.09] pt-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Recommended actions · {report.actionItems.length}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {report.actionItems.map((action) => <GrowthActionCard key={action.id} action={action} />)}
          </div>
        </section>
      )}
    </div>
  );
}

export function GrowthAdminReportsCard(props: { app: object, projectId: string }) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Pinned once per mount rather than read during render, so the relative timestamps do not shift.
  const [nowMillis] = useState(() => Date.now());

  const load = useCallback(async () => {
    setList({ status: "loading" });
    try {
      setList({ status: "loaded", body: await getGrowthAdminReports(props.app, props.projectId) });
    } catch (error) {
      captureError("growth-admin-reports-load", error);
      setList({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [props.app, props.projectId]);

  useEffect(() => {
    // Selection is per-project: switching the target project in the page's dropdown must not leave
    // another project's report open underneath the new list.
    setSelectedId(null);
    setDetail({ status: "idle" });
    runAsynchronously(load());
  }, [load]);

  const openReport = useCallback(async (reportId: string) => {
    setSelectedId(reportId);
    setDetail({ status: "loading" });
    try {
      setDetail({ status: "loaded", report: await getGrowthAdminReport(props.app, props.projectId, reportId) });
    } catch (error) {
      captureError("growth-admin-reports-detail", error);
      setDetail({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [props.app, props.projectId]);

  /**
   * Errors surface inline rather than being thrown: the realistic one here is the 409 for
   * unpublishing something already unpublished (two staff tabs open on the same project), which is
   * information, not a crash.
   */
  const mutate = async (label: string, mutation: () => Promise<GrowthAdminReportsBody>, afterSuccess?: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      setList({ status: "loaded", body: await mutation() });
      if (afterSuccess != null) await afterSuccess();
    } catch (error) {
      captureError(label, error);
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const subtitle = "Internal analysis for staff review. Author and explicitly publish the customer presentation below.";

  if (list.status === "loading") {
    return (
      <DesignCard title="Reports" subtitle={subtitle} icon={FileTextIcon} gradient="blue">
        <div className="h-20 animate-pulse rounded-xl border border-foreground/[0.06] bg-foreground/[0.03]" aria-busy="true" aria-label="Loading growth reports" />
      </DesignCard>
    );
  }
  if (list.status === "error") {
    return (
      <DesignCard title="Reports" subtitle={subtitle} icon={FileTextIcon} gradient="blue">
        <DesignAlert variant="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load reports: {list.message}</span>
            <DesignButton variant="outline" size="sm" onClick={async () => await load()}>Retry</DesignButton>
          </div>
        </DesignAlert>
      </DesignCard>
    );
  }

  const { reports } = list.body;
  const selected = reports.find((report) => report.id === selectedId) ?? null;

  return (
    <DesignCard title="Reports" subtitle={subtitle} icon={FileTextIcon} gradient="blue">
      <div className="space-y-4">
        {actionError != null && <DesignAlert variant="error">{actionError}</DesignAlert>}

        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reports for this project yet. One is written at the end of an analysis run, once the
            customer has finished their interview.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {reports.length} {reports.length === 1 ? "report" : "reports"} · newest first
            </p>
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                selected={report.id === selectedId}
                nowMillis={nowMillis}
                onSelect={() => runAsynchronously(openReport(report.id))}
              />
            ))}
          </div>
        )}

        {selected != null && (
          <div className="space-y-3 border-t border-foreground/[0.09] pt-4">
            <div className="flex flex-wrap items-center gap-2">
              {selected.publishedAtMillis == null ? (
                <span className="text-xs text-muted-foreground">
                  Pulled — the customer can no longer read this. Author and publish a presentation
                  below when it is ready.
                </span>
              ) : (
                <>
                  <DesignButton
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => await mutate(
                      "growth-admin-reports-unpublish",
                      () => unpublishGrowthAdminReport(props.app, props.projectId, selected.id),
                      async () => await openReport(selected.id),
                    )}
                  >
                    Unpublish
                  </DesignButton>
                  <span className="text-xs text-muted-foreground">
                    Live since {formatGrowthRelativeTime(selected.publishedAtMillis, nowMillis)}
                    {selected.publishedByUserId != null && <> · published by {selected.publishedByUserId}</>}
                  </span>
                </>
              )}
            </div>

            {detail.status === "loading" && (
              <div className="h-40 animate-pulse rounded-xl border border-foreground/[0.06] bg-foreground/[0.03]" aria-busy="true" aria-label="Loading the report" />
            )}
            {detail.status === "error" && (
              <DesignAlert variant="error">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>Could not load this report: {detail.message}</span>
                  <DesignButton variant="outline" size="sm" onClick={async () => await openReport(selected.id)}>Retry</DesignButton>
                </div>
              </DesignAlert>
            )}
            {detail.status === "loaded" && <ReportPreview report={detail.report} />}
            {detail.status === "loaded" && (
              <PresentationEditor
                app={props.app}
                projectId={props.projectId}
                report={detail.report}
                onReportChange={(report) => {
                  setDetail({ status: "loaded", report });
                  setList((current) => current.status !== "loaded" ? current : {
                    status: "loaded",
                    body: {
                      reports: current.body.reports.map((summary) => summary.id === report.id
                        ? {
                          ...summary,
                          publishedAtMillis: report.publishedAtMillis,
                          publishedByUserId: report.publishedByUserId,
                        }
                        : summary),
                    },
                  });
                }}
              />
            )}
          </div>
        )}
      </div>
    </DesignCard>
  );
}
