"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCard } from "@/components/design-components";
import { Link } from "@/components/link";
import { activateGrowthAction, GrowthApiError, getGrowthReport, markGrowthReportRead } from "@/lib/growth/growth-api";
import { type GrowthLoadable, useGrowthStatus } from "@/lib/growth/growth-data";
import { GROWTH_DEMO_NOW_MILLIS, buildGrowthDemoReport } from "@/lib/growth/growth-demo-data";
import type { GrowthActionItem, GrowthActionStatus, GrowthCustomerActionItem, GrowthReport, GrowthStatus } from "@/lib/growth/growth-types";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useAdminApp, useProjectId } from "../../use-admin-app";
import { GrowthActionStatusBadge, useGrowthHref } from "../components/action-card";
import { GrowthAppFrame, GrowthStatusGate } from "../components/frame";
import { GrowthPresentationSandbox } from "../components/presentation-sandbox";
import { GrowthReportHoldPanel } from "../components/report-hold";
import { GrowthReportSections } from "../components/report-sections";
import { GrowthDocumentRenderer } from "../components/growth-document";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Report" description="Your full growth report with recommended actions" allowContentOverflow>
        <GrowthStatusGate>
          {(status) => (
            <ReportBody
              latestReport={status.latestReport}
              // "Your report is being prepared" vs "run an analysis first" — the difference matters,
              // because this page is most likely to be opened during exactly the window where the
              // wrong one of those reads as "nothing is happening".
              //
              // This used to be derived here, from an interview/analysis pair chosen to work around
              // the wire collapsing COMPOSING_REPORT into "completed". It now comes from the server,
              // which is also the only thing that knows whether the report has been released —
              // something no combination of the other fields can tell you.
              held={status.release.state === "preparing"}
            />
          )}
        </GrowthStatusGate>
      </PageLayout>
    </GrowthAppFrame>
  );
}

function ReportEmptyState(props: { held: boolean }) {
  const projectId = useProjectId();
  const withQuery = useGrowthHref();
  const overviewLink = (
    <Link href={withQuery(`/projects/${projectId}/gtm`)}>
      <DesignButton variant="outline" size="sm">Go to the Growth overview</DesignButton>
    </Link>
  );
  if (props.held) {
    return <GrowthReportHoldPanel>{overviewLink}</GrowthReportHoldPanel>;
  }
  return (
    <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
      <p className="text-sm font-medium text-foreground">No report yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Run an analysis first — your report appears here once the analysis and interview are complete.
      </p>
      <div className="mt-4 flex justify-center">{overviewLink}</div>
    </div>
  );
}

// `value: null` means "no report is readable yet" — either none has been written, or one has been
// written and not yet released to this customer. Both are valid loaded states, not errors, and the
// backend deliberately 404s them identically (see getGrowthReportBody's publishedOnly option).
function ReportBody(props: { latestReport: GrowthStatus["latestReport"], held: boolean }) {
  const app = useAdminApp();
  const { demo, refresh: refreshStatus } = useGrowthStatus();
  const [data, setData] = useState<GrowthLoadable<GrowthReport | null>>({ status: "loading" });
  const markedReadReportIdRef = useRef<string | null>(null);
  const hasReport = props.latestReport != null;

  const load = useCallback(async () => {
    if (demo) {
      setData({ status: "loaded", value: hasReport ? buildGrowthDemoReport(GROWTH_DEMO_NOW_MILLIS) : null });
      return;
    }
    try {
      setData({ status: "loaded", value: await getGrowthReport(app, "latest") });
    } catch (error) {
      // "latest" 404s until the first report is composed — that's the empty state, not a failure.
      if (error instanceof GrowthApiError && error.statusCode === 404) {
        setData({ status: "loaded", value: null });
        return;
      }
      captureError("growth-report-load", error);
      setData({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, demo, hasReport]);

  useEffect(() => {
    setData({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  const reportId = data.status === "loaded" ? data.value?.id ?? null : null;
  const shouldMarkRead = !demo
    && reportId != null
    && props.latestReport?.id === reportId
    && props.latestReport.readAtMillis == null
    && markedReadReportIdRef.current !== reportId;
  useEffect(() => {
    if (!shouldMarkRead) return;
    markedReadReportIdRef.current = reportId;
    // The receipt only controls a reminder on the overview. Never delay the report itself for this
    // cosmetic write; capture a failure so it is diagnosable, and leave the reminder visible.
    runAsynchronously(async () => {
      try {
        await markGrowthReportRead(app, reportId);
        await refreshStatus();
      } catch (error) {
        captureError("growth-report-mark-read", error);
      }
    });
  }, [app, refreshStatus, reportId, shouldMarkRead]);

  if (data.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading growth report">
        <div className="h-40 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        <div className="h-32 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        <div className="h-32 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <DesignAlert variant="error" className="items-center">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>Could not load your growth report: {data.message}</span>
          <DesignButton variant="outline" size="sm" onClick={async () => {
            setData({ status: "loading" });
            await load();
          }}>
            Retry
          </DesignButton>
        </div>
      </DesignAlert>
    );
  }
  if (data.value == null) {
    return <ReportEmptyState held={props.held} />;
  }
  return <ReportContent report={data.value} demo={demo} />;
}

function ReportContent(props: { report: GrowthReport, demo: boolean }) {
  const { report } = props;
  const legacyReport = "title" in report ? report : null;
  return (
    <div className="flex flex-col gap-8">
      {legacyReport != null && (
        <header className="border-b border-foreground/[0.08] pb-7">
          <p className="text-xs text-muted-foreground">Created {new Date(report.createdAtMillis).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>
          <h1 className="mt-2 max-w-4xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{legacyReport.title}</h1>
          <p className="mt-3 max-w-3xl text-pretty text-sm leading-6 text-muted-foreground sm:text-base">{legacyReport.summary}</p>
        </header>
      )}

      <ReportDocumentContent report={report} />

      {report.actionItems.length > 0 && (
        <section className="border-t border-foreground/[0.08] pt-8">
          <h2 className="text-xl font-semibold tracking-tight">Recommended actions</h2>
          <p className="mt-1 text-sm text-muted-foreground">These are the actions selected for you. Activate one when you are ready to start it.</p>
          <div className="mt-4 flex flex-col gap-3">
            {report.actionItems.map((action) => <CustomerGrowthActionCard key={action.id} action={action} demo={props.demo} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function ReportDocumentContent(props: { report: GrowthReport }) {
  const { content } = props.report;
  const [presentationErrorSource, setPresentationErrorSource] = useState<string | null>(null);
  const [presentationAttempt, setPresentationAttempt] = useState(0);
  if (content.type === "presentation") {
    if (presentationErrorSource === content.tsxSource) {
      return (
        <DesignAlert variant="error">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>This report presentation is temporarily unavailable. Please try again.</span>
            <DesignButton
              variant="outline"
              size="sm"
              onClick={() => {
                setPresentationErrorSource(null);
                setPresentationAttempt((current) => current + 1);
              }}
            >
              Retry
            </DesignButton>
          </div>
        </DesignAlert>
      );
    }
    return <GrowthPresentationSandbox key={`${content.tsxSource}-${presentationAttempt}`} tsxSource={content.tsxSource} onRuntimeError={() => setPresentationErrorSource(content.tsxSource)} />;
  }
  if (content.document == null) {
    return <GrowthReportSections contentMd={content.contentMd} sections={content.sections} />;
  }
  return <GrowthDocumentRenderer document={content.document} />;
}

function CustomerGrowthActionCard(props: { action: GrowthActionItem | GrowthCustomerActionItem, demo: boolean }) {
  const app = useAdminApp();
  const [status, setStatus] = useState<GrowthActionStatus>(props.action.status);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    setError(null);
    if (props.demo) {
      setStatus("active");
      return;
    }
    try {
      const result = await activateGrowthAction(app, props.action.id);
      setStatus(result.status);
    } catch (activationError) {
      captureError("growth-customer-action-activate", activationError);
      setError("We couldn't activate this action. Please try again.");
    }
  };

  return (
    <DesignCard>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{props.action.title}</h3>
          <GrowthActionStatusBadge status={status} />
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{props.action.description}</p>
        {error != null && <DesignAlert variant="error">{error}</DesignAlert>}
        {status === "proposed" && (
          <DesignButton size="sm" className="self-start" onClick={handleActivate}>
            Activate action
          </DesignButton>
        )}
        {status === "active" && <DesignBadge label="This action is active" color="green" size="sm" />}
      </div>
    </DesignCard>
  );
}
