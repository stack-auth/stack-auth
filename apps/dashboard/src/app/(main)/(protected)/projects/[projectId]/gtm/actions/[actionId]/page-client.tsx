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
import { activateGrowthAction, dismissGrowthAction, generateGrowthActionBlogDraft, listGrowthActions } from "@/lib/growth/growth-api";
import { getGrowthActionNarrativeSections } from "@/lib/growth/growth-action-document";
import { type GrowthLoadable, useGrowthStatus } from "@/lib/growth/growth-data";
import { GROWTH_DEMO_NOW_MILLIS, buildGrowthDemoActions, buildGrowthDemoAdsBodyForAction } from "@/lib/growth/growth-demo-data";
import type { GrowthDocument, GrowthDocumentBlock } from "@/lib/growth/growth-document";
import type { GrowthActionItem, GrowthActionWorkflow } from "@/lib/growth/growth-types";
import { humanizeGrowthWorkflowTriggers, splitGrowthWorkflowWarnings } from "@/lib/growth/growth-workflow-format";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { ArrowLeftIcon, ArrowSquareOutIcon, ArticleIcon, CheckCircleIcon, LightningIcon, ProhibitIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PageLayout } from "../../../page-layout";
import { useAdminApp, useProjectId } from "../../../use-admin-app";
import { WorkflowRunsGrid, WorkflowTriggers } from "../../../workflows/shared";
import { GROWTH_ACTION_TYPE_META, GrowthActionStatusBadge, useGrowthHref } from "../../components/action-card";
import { GrowthAppFrame } from "../../components/frame";
import { GrowthMarkdown } from "../../components/report-sections";
import { GrowthWorkflowSourceViewer } from "../../components/workflow-source-viewer";
import { GrowthDocumentFragment } from "../../components/growth-document";
import { RunAdsPayloadSection } from "./ads-panel";

export default function PageClient() {
  return (
    <GrowthAppFrame>
      <PageLayout title="Growth Action" description="Hypothesis, evidence, and experiment" allowContentOverflow>
        <ActionDetailBody />
      </PageLayout>
    </GrowthAppFrame>
  );
}

type ActionDetail = {
  /** `null` = the id doesn't exist in this workspace (not-found state, not an error). */
  action: GrowthActionItem | null,
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
        },
      });
      return;
    }
    try {
      const action = await findActionById(app, actionId);
      setData({ status: "loaded", value: { action } });
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
      href={withQuery(`/projects/${projectId}/gtm`)}
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

function ActionNarrativeSection(props: { title: "Hypothesis" | "Evidence" | "Experiment", document: GrowthDocument | null, blocks: GrowthDocumentBlock[], children?: React.ReactNode }) {
  return (
    <section aria-labelledby={`action-${props.title.toLocaleLowerCase()}`}>
      <h2 id={`action-${props.title.toLocaleLowerCase()}`} className="mb-4 text-xl font-semibold tracking-tight">{props.title}</h2>
      {props.document != null && props.blocks.length > 0
        ? <GrowthDocumentFragment document={props.document} blocks={props.blocks} className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
        : <DesignAlert variant="warning">This suggestion does not include {props.title.toLocaleLowerCase()} content.</DesignAlert>}
      {props.children}
    </section>
  );
}

function ActionNarrative(props: { action: GrowthActionItem, onChanged: () => Promise<void> }) {
  const { action } = props;
  const document = action.document ?? null;
  const sections = document == null
    ? { hypothesis: [], evidence: [], experiment: [] }
    : getGrowthActionNarrativeSections(document);
  return (
    <section className="border-y border-foreground/[0.08] py-7">
      <article className="mx-auto w-full max-w-4xl">
        <ActionHeading action={action} />
        <div className="flex flex-col gap-10">
          <ActionNarrativeSection title="Hypothesis" document={document} blocks={sections.hypothesis} />
          <ActionNarrativeSection title="Evidence" document={document} blocks={sections.evidence} />
          <ActionNarrativeSection title="Experiment" document={document} blocks={sections.experiment}>
            {action.workflow != null && <div className="mt-5"><ActionAutomationPreview action={action} workflow={action.workflow} /></div>}
            <div className="mt-5"><ActionMutationControls action={action} onChanged={props.onChanged} /></div>
          </ActionNarrativeSection>
        </div>
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
