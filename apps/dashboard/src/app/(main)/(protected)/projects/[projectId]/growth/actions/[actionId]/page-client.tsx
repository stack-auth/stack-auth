"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignDialogClose,
} from "@/components/design-components";
import { Link } from "@/components/link";
import { useRouter } from "@/components/router";
import { activateGrowthAction, dismissGrowthAction, generateGrowthActionBlogDraft, getGrowthActionMetrics, listGrowthActions } from "@/lib/growth/growth-api";
import { type GrowthLoadable, useGrowthStatus } from "@/lib/growth/growth-data";
import { GROWTH_DEMO_NOW_MILLIS, buildGrowthDemoActions, buildGrowthDemoAdsBodyForAction } from "@/lib/growth/growth-demo-data";
import type { GrowthDocument, GrowthDocumentBlock, GrowthDocumentInline, GrowthEvidenceDatum } from "@/lib/growth/growth-document";
import { formatGrowthAdSpend, formatGrowthMetricValue } from "@/lib/growth/growth-format";
import type { GrowthActionItem, GrowthActionMetricSeries, GrowthActionWorkflow } from "@/lib/growth/growth-types";
import { humanizeGrowthWorkflowTriggers, splitGrowthWorkflowWarnings } from "@/lib/growth/growth-workflow-format";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { CopyPromptButton } from "@/components/ui/copy-button";
import { ArrowLeftIcon, ArrowSquareOutIcon, ArticleIcon, CheckCircleIcon, EyeIcon, LightningIcon, ProhibitIcon, SparkleIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PageLayout } from "../../../page-layout";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { WorkflowRunsGrid, WorkflowTriggers } from "../../../workflows/shared";
import { GROWTH_ACTION_TYPE_META, GrowthActionStatusBadge, useGrowthHref } from "../../components/action-card";
import { GrowthAppFrame } from "../../components/frame";
import { buildGrowthDemoActionMetrics, getGrowthMetricLabel, sumMetricSeries } from "../../components/metric-comparison";
import { GrowthMarkdown } from "../../components/report-sections";
import { GrowthWorkflowSourceViewer } from "../../components/workflow-source-viewer";
import { GrowthDocumentFragment } from "../../components/growth-document";
import { RunAdsPayloadSection } from "./ads-panel";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Action" description="Experiment details and watched metrics" allowContentOverflow>
        <ActionDetailBody />
      </PageLayout>
    </GrowthAppFrame>
  );
}

type ActionDetail = {
  /** `null` = the id doesn't exist in this workspace (not-found state, not an error). */
  action: GrowthActionItem | null,
  metrics: GrowthActionMetricSeries[],
};

// There is no single-action GET endpoint (deliberate: the list endpoint is the only read surface for
// actions), so the detail page pages through the list until it finds its id. The page bound is a
// safety valve against a pathological workspace; hitting it is a bug worth failing loudly on.
const MAX_LOOKUP_PAGES = 25;

async function findActionById(app: object, actionId: string): Promise<GrowthActionItem | null> {
  let cursor: string | undefined = undefined;
  for (let page = 0; page < MAX_LOOKUP_PAGES; page++) {
    const result = await listGrowthActions(app, cursor == null ? {} : { cursor });
    const match = result.items.find((item) => item.id === actionId);
    if (match != null) return match;
    if (result.nextCursor == null) return null;
    cursor = result.nextCursor;
  }
  throw new Error(`Could not find the action within ${MAX_LOOKUP_PAGES} pages of action results.`);
}

function ActionDetailBody() {
  const app = useAdminApp();
  const projectId = useProjectId();
  const withQuery = useGrowthHref();
  const { demo } = useGrowthStatus();
  const params = useParams<{ actionId: string }>();
  const actionId = params.actionId;
  const [data, setData] = useState<GrowthLoadable<ActionDetail>>({ status: "loading" });

  const load = useCallback(async () => {
    if (demo) {
      const action = buildGrowthDemoActions(GROWTH_DEMO_NOW_MILLIS).find((item) => item.id === actionId) ?? null;
      setData({
        status: "loaded",
        value: {
          action,
          metrics: action == null ? [] : buildGrowthDemoActionMetrics(action, GROWTH_DEMO_NOW_MILLIS),
        },
      });
      return;
    }
    try {
      const action = await findActionById(app, actionId);
      const metrics = action == null ? [] : await getGrowthActionMetrics(app, actionId);
      setData({ status: "loaded", value: { action, metrics } });
    } catch (error) {
      captureError("growth-action-detail-load", error);
      setData({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app, demo, actionId]);

  useEffect(() => {
    setData({ status: "loading" });
    runAsynchronously(load());
  }, [load]);

  const backLink = (
    <Link
      href={withQuery(`/projects/${projectId}/growth`)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground hover:transition-none"
    >
      <ArrowLeftIcon className="size-4" />
      Growth overview
    </Link>
  );

  if (data.status === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading action">
        {backLink}
        <div className="h-48 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-64 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
          <div className="h-64 animate-pulse rounded-2xl border border-foreground/[0.06] bg-foreground/[0.03]" />
        </div>
      </div>
    );
  }
  if (data.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <DesignAlert variant="error" className="items-center">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Could not load this action: {data.message}</span>
            <DesignButton variant="outline" size="sm" onClick={async () => {
              setData({ status: "loading" });
              await load();
            }}>
              Retry
            </DesignButton>
          </div>
        </DesignAlert>
      </div>
    );
  }
  if (data.value.action == null) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <div className="rounded-2xl border border-dashed border-foreground/[0.1] bg-foreground/[0.02] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            This action does not exist (or was removed). Head back to the Growth overview to see the latest suggestions.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {backLink}
      <ActionNarrative
        action={data.value.action}
        metrics={data.value.metrics}
        onChanged={load}
      />
      <ActionPayloadSection action={data.value.action} demo={demo} onChanged={load} />
    </div>
  );
}

/**
 * Confirm-dialog-gated mutation button. In demo mode the dialog explains that mutations are disabled
 * instead of offering a confirm, so the flow is still explorable end to end.
 */
function ConfirmActionButton(props: {
  buttonLabel: string,
  buttonVariant: "default" | "outline",
  icon: React.ElementType,
  title: string,
  description: string,
  /** Rich dialog content rendered instead of the plain description paragraph (the description still shows in the header). */
  body?: React.ReactNode,
  confirmLabel: string,
  demo: boolean,
  onConfirm: () => Promise<void>,
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = props.icon;
  return (
    <DesignDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
      trigger={<DesignButton variant={props.buttonVariant} size="sm">{props.buttonLabel}</DesignButton>}
      icon={Icon}
      size="md"
      title={props.title}
      description={props.demo ? "Demo mode" : props.description}
      footer={
        props.demo ? (
          <DesignDialogClose asChild>
            <DesignButton variant="secondary" size="sm">Close</DesignButton>
          </DesignDialogClose>
        ) : (
          <>
            <DesignDialogClose asChild>
              <DesignButton variant="secondary" size="sm">Cancel</DesignButton>
            </DesignDialogClose>
            <DesignButton
              size="sm"
              onClick={async () => {
                setError(null);
                try {
                  await props.onConfirm();
                } catch (confirmError) {
                  captureError("growth-action-mutation", confirmError);
                  setError(confirmError instanceof Error ? confirmError.message : String(confirmError));
                  return;
                }
                setOpen(false);
              }}
            >
              {props.confirmLabel}
            </DesignButton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {props.demo ? (
          <DesignAlert variant="info">
            You are looking at fixture data — actions cannot be changed in demo mode.
          </DesignAlert>
        ) : (
          props.body ?? <p className="text-sm text-muted-foreground">{props.description}</p>
        )}
        {error != null && <DesignAlert variant="error">This didn&apos;t work: {error}</DesignAlert>}
      </div>
    </DesignDialog>
  );
}

function inlineText(nodes: GrowthDocumentInline[]): string {
  return nodes.map((node) => {
    switch (node.type) {
      case "text":
      case "code": {
        return node.value;
      }
      case "break": {
        return " ";
      }
      case "strong":
      case "emphasis":
      case "delete":
      case "link": {
        return inlineText(node.children);
      }
    }
  }).join("");
}

type ActionDocumentSections = {
  main: GrowthDocumentBlock[],
  success: GrowthDocumentBlock[],
  action: GrowthDocumentBlock[],
};

function reorderEvidenceAfterHypothesis(blocks: GrowthDocumentBlock[]): GrowthDocumentBlock[] {
  const chunks: GrowthDocumentBlock[][] = [];
  for (const block of blocks) {
    if (block.type === "heading" || chunks.length === 0) {
      chunks.push([block]);
    } else {
      (chunks.at(-1) ?? throwErr("The action document section list must have a current chunk.")).push(block);
    }
  }
  const headingFor = (chunk: GrowthDocumentBlock[]) => {
    const first = chunk.at(0);
    return first?.type === "heading" ? inlineText(first.children).trim().toLocaleLowerCase() : null;
  };
  const evidenceIndex = chunks.findIndex((chunk) => headingFor(chunk) === "evidence");
  const hypothesisIndex = chunks.findIndex((chunk) => headingFor(chunk) === "hypothesis");
  if (evidenceIndex < 0 || hypothesisIndex < 0 || evidenceIndex > hypothesisIndex) return blocks;
  const evidence = chunks.splice(evidenceIndex, 1).at(0) ?? throwErr("The Evidence section disappeared while reordering the action document.");
  const updatedHypothesisIndex = chunks.findIndex((chunk) => headingFor(chunk) === "hypothesis");
  chunks.splice(updatedHypothesisIndex + 1, 0, evidence);
  return chunks.flat();
}

/**
 * The analysis document predates this page's operational controls, so its success/action sections
 * arrive as prose. Pull those two sections into purpose-built UI while leaving every other block in
 * source order. Unknown headings return rendering to the main document instead of being swallowed.
 */
function splitActionDocument(document: GrowthDocument, actionTitle: string): ActionDocumentSections {
  const sections: ActionDocumentSections = { main: [], success: [], action: [] };
  let destination: keyof ActionDocumentSections = "main";
  for (const block of document.blocks) {
    if (block.type === "heading") {
      const heading = inlineText(block.children).trim();
      const normalized = heading.toLocaleLowerCase();
      if (normalized === actionTitle.trim().toLocaleLowerCase()) continue;
      if (normalized === "success metric" || normalized === "success metrics" || normalized === "watch metrics") {
        destination = "success";
        continue;
      }
      if (normalized === "action") {
        destination = "action";
        continue;
      }
      destination = "main";
    }
    sections[destination].push(block);
  }
  return { ...sections, main: reorderEvidenceAfterHypothesis(sections.main) };
}

function collectMetricDataIds(blocks: GrowthDocumentBlock[]): string[] {
  const ids: string[] = [];
  for (const block of blocks) {
    if (block.type === "component") {
      if (block.name === "Metric" && block.dataId != null) ids.push(block.dataId);
      ids.push(...collectMetricDataIds(block.children));
    } else if (block.type === "list") {
      for (const item of block.items) ids.push(...collectMetricDataIds(item));
    }
  }
  return ids;
}

function formatEvidenceMetric(value: number, datum: Extract<GrowthEvidenceDatum, { kind: "metric" }>): string {
  return datum.unit === "minor_units"
    ? formatGrowthAdSpend(value, datum.currency ?? "")
    : formatGrowthMetricValue(value, datum.unit);
}

function ActionHeading(props: { action: GrowthActionItem }) {
  const { action } = props;
  const typeMeta = GROWTH_ACTION_TYPE_META.get(action.typeId) ?? { label: action.typeId, icon: LightningIcon };
  const dateLabel = action.activatedAtMillis != null
    ? `Activated ${new Date(action.activatedAtMillis).toLocaleDateString()}`
    : `Proposed ${new Date(action.createdAtMillis).toLocaleDateString()}`;
  const TypeIcon = typeMeta.icon;
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-balance text-xl font-semibold tracking-tight">{action.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><TypeIcon className="size-3.5" />{typeMeta.label}</span>
          <span aria-hidden="true">·</span>
          <span>{dateLabel}</span>
        </div>
      </div>
      <GrowthActionStatusBadge status={action.status} size="md" />
    </header>
  );
}

type WatchedMetricRow = {
  id: string,
  label: string,
  before: string,
  beforeLabel: string,
  goal: string,
  goalLabel: string,
};

function buildWatchedMetricRows(document: GrowthDocument | null, successBlocks: GrowthDocumentBlock[], metrics: GrowthActionMetricSeries[]): WatchedMetricRow[] {
  const targets = document == null
    ? []
    : collectMetricDataIds(successBlocks).flatMap((id) => {
      const datum = document.data.find((candidate) => candidate.id === id);
      return datum?.kind === "metric" ? [datum] : [];
    });
  const hasTextualGoal = successBlocks.length > 0 && targets.length === 0;
  const rowCount = Math.max(targets.length, metrics.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const target = targets.at(index);
    const series = metrics.at(index);
    const beforeTotal = series == null ? null : sumMetricSeries(series.before);
    return {
      id: target?.id ?? series?.metricId ?? `watched-metric-${index}`,
      label: target?.title.replace(/^Target:\s*/i, "") ?? (series == null ? "Watched metric" : getGrowthMetricLabel(series.metricId)),
      before: target?.comparisonValue != null
        ? formatEvidenceMetric(target.comparisonValue, target)
        : beforeTotal == null ? "Not captured" : beforeTotal.toLocaleString(),
      beforeLabel: target?.comparisonLabel ?? (series == null ? "Baseline before activation" : `${series.windowDays}-day baseline before activation`),
      goal: target == null ? (hasTextualGoal ? "Defined below" : "Not set") : formatEvidenceMetric(target.value, target),
      goalLabel: target?.takeaway ?? (hasTextualGoal ? "Use the experiment's success criteria below." : "Set a measurable target before activating this experiment."),
    };
  });
}

function WatchMetricsSection(props: { action: GrowthActionItem, document: GrowthDocument | null, successBlocks: GrowthDocumentBlock[], metrics: GrowthActionMetricSeries[] }) {
  const rows = buildWatchedMetricRows(props.document, props.successBlocks, props.metrics);
  const hasStructuredTarget = collectMetricDataIds(props.successBlocks).length > 0;
  const hasTextualGoal = props.document != null && props.successBlocks.length > 0 && !hasStructuredTarget;
  const trackingCopy = props.action.activatedAtMillis == null
    ? "When you activate this experiment, Hexclave captures the before window and starts watching the same metrics after activation."
    : "Hexclave is comparing the same metrics after activation against the captured before window.";
  return (
    <div className="mt-7">
      <DesignCard title="Watch metrics" subtitle={trackingCopy} icon={EyeIcon} gradient="cyan">
        {rows.length === 0 ? (
          <DesignAlert variant="default">This experiment does not have any watched metrics yet.</DesignAlert>
        ) : (
          <div className="divide-y divide-foreground/[0.08]">
            {rows.map((row) => (
              <div key={row.id} className="py-4 first:pt-0 last:pb-0">
                <p className="mb-3 text-sm font-medium text-foreground">{row.label}</p>
                <div className="grid overflow-hidden rounded-xl ring-1 ring-foreground/[0.08] sm:grid-cols-2 sm:divide-x sm:divide-foreground/[0.08]">
                  <div className="bg-foreground/[0.025] p-4">
                    <p className="text-xs font-semibold text-muted-foreground">Before</p>
                    <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">{row.before}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.beforeLabel}</p>
                  </div>
                  <div className="border-t border-foreground/[0.08] bg-cyan-500/[0.05] p-4 sm:border-t-0">
                    <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">Goal</p>
                    <p className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums">{row.goal}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.goalLabel}</p>
                  </div>
                </div>
              </div>
            ))}
            {hasTextualGoal && props.document != null && (
              <div className="pt-4">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">Goal criteria</p>
                <GrowthDocumentFragment document={props.document} blocks={props.successBlocks} className="[&>ol:last-child]:mb-0 [&>p:last-child]:mb-0 [&>ul:last-child]:mb-0" />
              </div>
            )}
          </div>
        )}
      </DesignCard>
    </div>
  );
}

function ActionMutationControls(props: { action: GrowthActionItem, onChanged: () => Promise<void> }) {
  const { action } = props;
  const app = useAdminApp();
  const { demo } = useGrowthStatus();
  if (action.status !== "proposed" && action.status !== "active") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-foreground/[0.08] pt-4">
      {action.status === "proposed" && (
        <ConfirmActionButton
          buttonLabel="Activate experiment"
          buttonVariant="default"
          icon={CheckCircleIcon}
          title="Activate this action?"
          description={action.workflow != null
            ? "Activating deploys and starts the attached automation, and begins the watched-metric comparison."
            : "Activating captures the before window and starts watching the same metrics after activation. You can dismiss it later."}
          body={action.workflow != null ? <ActivateWorkflowDialogBody workflow={action.workflow} /> : undefined}
          confirmLabel={action.workflow != null ? "Activate & deploy automation" : "Activate experiment"}
          demo={demo}
          onConfirm={async () => {
            await activateGrowthAction(app, action.id);
            await props.onChanged();
          }}
        />
      )}
      <ConfirmActionButton
        buttonLabel="Dismiss"
        buttonVariant="outline"
        icon={ProhibitIcon}
        title="Dismiss this action?"
        description={action.status === "active" && action.workflow != null && action.workflow.status !== "not_deployed"
          ? "Dismissing deletes the deployed automation and cancels any of its in-flight runs. The action's history and metrics stay, but the automation will never run again."
          : "Dismissed actions stop tracking metrics and move out of your list. This does not delete anything."}
        confirmLabel="Dismiss action"
        demo={demo}
        onConfirm={async () => {
          await dismissGrowthAction(app, action.id);
          await props.onChanged();
        }}
      />
    </div>
  );
}

function ActionExecutionCard(props: { action: GrowthActionItem, document: GrowthDocument | null, actionBlocks: GrowthDocumentBlock[], onChanged: () => Promise<void> }) {
  const { action } = props;
  return (
    <div className="mt-7">
      <DesignCard
        title="Action"
        subtitle="The execution plan and everything to review before activation"
        icon={LightningIcon}
        gradient="green"
      >
        <div className="flex flex-col gap-4">
          {props.document != null && props.actionBlocks.length > 0
            ? <GrowthDocumentFragment document={props.document} blocks={props.actionBlocks} className="[&>p:last-child]:mb-0" />
            : <p className="text-sm leading-7 text-muted-foreground">{action.description}</p>}
          {action.workflow != null && <ActionAutomationPreview action={action} workflow={action.workflow} />}
          <CodingAgentPromptPreview payload={action.payload} />
          <ActionMutationControls action={action} onChanged={props.onChanged} />
        </div>
      </DesignCard>
    </div>
  );
}

function ActionNarrative(props: { action: GrowthActionItem, metrics: GrowthActionMetricSeries[], onChanged: () => Promise<void> }) {
  const { action } = props;
  const document = action.document ?? null;
  const sections = document == null ? { main: [], success: [], action: [] } : splitActionDocument(document, action.title);
  return (
    <section className="border-y border-foreground/[0.08] py-7">
      <article className="mx-auto w-full max-w-4xl">
        <ActionHeading action={action} />
        {document != null && sections.main.length > 0 && <GrowthDocumentFragment document={document} blocks={sections.main} />}
        <WatchMetricsSection action={action} document={document} successBlocks={sections.success} metrics={props.metrics} />
        <ActionExecutionCard action={action} document={document} actionBlocks={sections.action} onChanged={props.onChanged} />
      </article>
    </section>
  );
}

/**
 * Execution-specific activation copy for a workflow-bearing action. This dialog is the customer's
 * one informed-consent moment before code runs on their project, so it states — from the wire, not
 * from generic copy — what the automation does, when it runs, which external domains its source
 * references, and how to undo it.
 */
function ActivateWorkflowDialogBody(props: { workflow: GrowthActionWorkflow }) {
  const { workflow } = props;
  const { externalDomains, otherWarnings } = splitGrowthWorkflowWarnings(workflow.warnings);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What it does</p>
        <p className="mt-1 text-muted-foreground">{workflow.explanation}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">When it runs</p>
        <p className="mt-1 text-muted-foreground">Runs {humanizeGrowthWorkflowTriggers(workflow.triggers)}.</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">External calls</p>
        {externalDomains.length === 0 ? (
          <p className="mt-1 text-muted-foreground">No external domains detected in the source — it only talks to your Hexclave project.</p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            The source references: {externalDomains.map((domain, index) => (
              <span key={domain}>
                {index > 0 && ", "}
                <span className="font-mono text-foreground">{domain}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Undoing it</p>
        <p className="mt-1 text-muted-foreground">{workflow.rollbackNote}</p>
      </div>
      {otherWarnings.length > 0 && (
        <DesignAlert variant="warning">
          <ul className="list-disc pl-4">
            {otherWarnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </DesignAlert>
      )}
      <p className="text-xs text-muted-foreground">
        The automation is deployed as an ordinary workflow (id <span className="font-mono">{workflow.workflowId}</span>) that you can inspect, edit, or delete in the Workflows app at any time.
      </p>
    </div>
  );
}

const WORKFLOW_STATUS_BADGE = new Map<GrowthActionWorkflow["status"], { label: string, color: "cyan" | "green" | "orange" }>([
  ["not_deployed", { label: "Not deployed", color: "cyan" }],
  ["deployed", { label: "Deployed", color: "green" }],
  ["deleted", { label: "Deleted", color: "orange" }],
]);

/**
 * Run history for a deployed automation. Split out because it needs the workflow's latest version
 * (a WorkflowRunsGrid requirement) from the workflows listing hook, which only makes sense to
 * subscribe to once we know the workflow is deployed.
 */
function DeployedWorkflowRuns(props: { workflowId: string }) {
  const app = useAdminApp();
  const projectId = useProjectId();
  const withQuery = useGrowthHref();
  const router = useRouter();
  const workflows = app.useWorkflows();
  const workflow = workflows.find((candidate) => candidate.id === props.workflowId);
  if (workflow == null) {
    // The wire said "deployed" but the listing lacks the definition — a race with a just-deleted
    // workflow. Reloading resolves it; render the same non-blocking notice as the deleted state.
    return (
      <DesignAlert variant="default">
        The automation&apos;s workflow could not be found in this project — it may have just been deleted. Reload to refresh its status.
      </DesignAlert>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Run history</span>
      <WorkflowRunsGrid
        workflowId={workflow.id}
        latestVersion={workflow.latestVersion}
        maxHeight={320}
        onOpenRun={() => {
          // Run drill-in (step timeline, retries) lives in the workflows app; hand over instead of
          // duplicating the dialog here.
          router.push(withQuery(`/projects/${projectId}/workflows/${workflow.id}`));
        }}
      />
    </div>
  );
}

function ActionAutomationPreview(props: { action: GrowthActionItem, workflow: GrowthActionWorkflow }) {
  const { action, workflow } = props;
  const projectId = useProjectId();
  const withQuery = useGrowthHref();
  const statusBadge = WORKFLOW_STATUS_BADGE.get(workflow.status) ?? { label: workflow.status, color: "cyan" as const };
  return (
    <div className="flex flex-col gap-4 border-t border-foreground/[0.08] pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold"><TreeStructureIcon className="size-4" />Workflow preview</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {action.status === "proposed" ? "Deployed and started when you activate this experiment" : "The workflow deployed by this experiment"}
          </p>
        </div>
        <DesignBadge label={statusBadge.label} color={statusBadge.color} size="md" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{workflow.workflowId}</span>
          <WorkflowTriggers triggers={workflow.triggers} />
          {workflow.status === "deployed" && (
            <Link
              href={withQuery(`/projects/${projectId}/workflows/${workflow.workflowId}`)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              Open in Workflows app
              <ArrowSquareOutIcon className="size-3.5" />
            </Link>
          )}
        </div>
        {workflow.status === "deleted" && (
          <DesignAlert variant="default">
            This automation was deleted in the Workflows app, so it will not run again. The action item itself stays — dismiss it if the work is off the table, or keep it to track the metrics.
          </DesignAlert>
        )}
        {workflow.status === "deployed" && workflow.lastRunState === "failed" && (
          <DesignAlert variant="error">
            The automation&apos;s most recent run failed. Open it in the Workflows app to see the failing step and retry it.
          </DesignAlert>
        )}
        {workflow.warnings.length > 0 && (
          <DesignAlert variant="warning">
            <ul className="list-disc pl-4">
              {workflow.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </DesignAlert>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">What it does</p>
            <p className="mt-1 text-sm text-muted-foreground">{workflow.explanation}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Undoing it</p>
            <p className="mt-1 text-sm text-muted-foreground">{workflow.rollbackNote}</p>
          </div>
        </div>
        <GrowthWorkflowSourceViewer workflowId={workflow.workflowId} source={workflow.source} />
        {workflow.status === "deployed" && <DeployedWorkflowRuns workflowId={workflow.workflowId} />}
      </div>
    </div>
  );
}

// The payload column is an opaque Json owned by the action-type registry; each type's renderer
// validates only the slice it needs and degrades gracefully (with a visible notice, never silently)
// when the shape is unexpected.
const blogPayloadSchema = z.object({ draft_markdown: z.string() });
// The idea an analysis run attaches instead of a finished post — the run proposes, the customer
// generates on demand (writing every proposed post inline was the slowest step of a growth run).
// Every field but the title is optional: a run that couldn't ground one shouldn't block generation.
const blogIdeaPayloadSchema = z.object({
  blog_idea: z.object({
    title: z.string(),
    target_intent: z.string().nullish(),
    aeo_angle: z.string().nullish(),
    outline_summary: z.string().nullish(),
  }),
});

// Actions that need a code or config change carry a self-contained prompt the reader pastes
// straight into their own coding agent — so "what do I actually type" is never left as an exercise.
const codingAgentPromptSchema = z.object({ coding_agent_prompt: z.string().min(1) });

/**
 * The copy-paste prompt for a code-change action. Rendered for ANY action type (a blog, an ad, or a
 * custom item can all need a code change), directly above the type-specific payload panel.
 */
function CodingAgentPromptPreview(props: { payload: unknown }) {
  const parsed = codingAgentPromptSchema.safeParse(props.payload);
  if (!parsed.success) return null;
  const prompt = parsed.data.coding_agent_prompt;
  return (
    <div className="flex flex-col gap-3 border-t border-foreground/[0.08] pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold"><SparkleIcon className="size-4" />Prompt preview</p>
          <p className="mt-1 text-xs text-muted-foreground">Review the implementation prompt before copying it to your coding agent.</p>
        </div>
        <CopyPromptButton size="sm" content={prompt}>Copy prompt</CopyPromptButton>
      </div>
      {/* Pre-wrapped rather than markdown-rendered: this is text to be copied verbatim, and
        * rendering it would hide the exact characters the reader is about to paste. */}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-foreground/[0.04] p-4 text-sm leading-relaxed">
        {prompt}
      </pre>
    </div>
  );
}

/** One labelled line of the proposed idea; omitted entirely when the run didn't ground that field. */
function BlogIdeaRow(props: { label: string, value: string | null | undefined }) {
  if (props.value == null || props.value.trim().length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">{props.label}</span>
      <span className="text-sm">{props.value}</span>
    </div>
  );
}

/**
 * The `publish_blog` payload panel. Two states, driven purely by whether a draft exists yet:
 * the proposed idea with a "Write the draft" button, or the finished post. The generated draft is
 * held in local state as well as written server-side, so the reader sees it immediately without
 * waiting for a refetch of the whole action.
 */
function BlogPayloadSection(props: { action: GrowthActionItem, demo: boolean }) {
  const app = useAdminApp();
  const { action, demo } = props;
  const [generatedDraft, setGeneratedDraft] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const storedDraft = blogPayloadSchema.safeParse(action.payload);
  const draftMarkdown = generatedDraft ?? (storedDraft.success ? storedDraft.data.draft_markdown : null);
  if (draftMarkdown != null) {
    return (
      <DesignCard title="Blog draft" subtitle="The post this action would publish" icon={ArticleIcon} gradient="purple">
        <GrowthMarkdown content={draftMarkdown} />
      </DesignCard>
    );
  }

  const idea = blogIdeaPayloadSchema.safeParse(action.payload);
  if (!idea.success) {
    return (
      <DesignCard title="Blog draft" subtitle="The post this action would publish" icon={ArticleIcon} gradient="purple">
        <DesignAlert variant="warning">
          This action has no readable draft or idea attached yet — it will appear here once the analysis prepares one.
        </DesignAlert>
      </DesignCard>
    );
  }

  const { blog_idea: blogIdea } = idea.data;
  return (
    <DesignCard title="Proposed post" subtitle="The analysis picked this piece — the draft is written when you ask for it" icon={ArticleIcon} gradient="purple">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <BlogIdeaRow label="Working title" value={blogIdea.title} />
          <BlogIdeaRow label="Target search intent" value={blogIdea.target_intent} />
          <BlogIdeaRow label="Answer-engine angle" value={blogIdea.aeo_angle} />
          <BlogIdeaRow label="What it should cover" value={blogIdea.outline_summary} />
        </div>
        {generateError != null && <DesignAlert variant="error">{generateError}</DesignAlert>}
        <div className="flex flex-wrap items-center gap-3">
          {/* DesignButton's async onClick drives its own loading state — generation takes a while,
            * so the button must not look idle while it runs. */}
          <DesignButton
            disabled={demo}
            onClick={async () => {
              setGenerateError(null);
              try {
                const result = await generateGrowthActionBlogDraft(app, action.id);
                setGeneratedDraft(result.draftMarkdown);
              } catch (error) {
                setGenerateError(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            Write the draft
          </DesignButton>
          {demo && <span className="text-sm text-muted-foreground">Demo mode — generating is disabled on fixture data.</span>}
        </div>
      </div>
    </DesignCard>
  );
}

function ActionPayloadSection(props: { action: GrowthActionItem, demo: boolean, onChanged: () => Promise<void> }) {
  const { action, demo, onChanged } = props;
  switch (action.typeId) {
    case "publish_blog": {
      return <BlogPayloadSection action={action} demo={demo} />;
    }
    case "run_ads": {
      return (
        <RunAdsPayloadSection
          actionId={action.id}
          actionStatus={action.status}
          payload={action.payload}
          demo={demo}
          demoAds={demo ? buildGrowthDemoAdsBodyForAction(action.id, GROWTH_DEMO_NOW_MILLIS) : null}
          onActivated={onChanged}
        />
      );
    }
    case "custom": {
      // Custom actions are described entirely by their title/description — nothing extra to render.
      return null;
    }
  }
}
