"use client";

import { DesignAlert, DesignButton, DesignSelectorDropdown } from "@/components/design-components";
import { getGrowthAdminEditGate } from "@/lib/growth/growth-admin-lifecycle";
import { createGrowthAdminNote, getGrowthAdminOverview, getGrowthAdminStatus, listGrowthAdminProjects, setGrowthAdminCategoryScore, updateGrowthAdminAction, updateGrowthAdminFinding, type GrowthAdminFunctionalActionFields, type GrowthAdminProject } from "@/lib/growth/growth-api";
import type { GrowthActionItem, GrowthOverview, GrowthStatus } from "@/lib/growth/growth-types";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useStackApp, useUser } from "@hexclave/next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageLayout } from "../../page-layout";
import { useProjectId } from "../../use-admin-app";
import { GrowthWorkspaceEditProvider, type GrowthWorkspaceEditors } from "../components/workspace-edit";
import { GrowthWorkspaceContent } from "../components/workspace-overview";
import { GrowthAdminActionInternalsCard } from "./action-internals-card";
import { GrowthAdminCategoryPageCard, GrowthAdminCategoryPagesProvider } from "./category-page-card";
import { GrowthAdminGamesCard } from "./games-card";
import { GrowthAdminInterviewCard } from "./interview-card";
import { GrowthAdminLifecycleCard } from "./lifecycle-card";
import { GrowthAdminReportsCard } from "./reports-card";
import { GrowthAdminRunNowCard } from "./run-now-card";

type Loadable =
  | { status: "loading" }
  | { status: "error", message: string }
  | { status: "loaded", projects: GrowthAdminProject[], selected: GrowthAdminProject | null, overview: GrowthOverview | null, lifecycle: GrowthStatus | null };

/**
 * Functional fields are immutable once an action leaves the proposal stage — the backend rejects them —
 * so they are only ever sent for proposals, and then unchanged: the workspace edits the customer-facing
 * fields, and resending the current values keeps the PATCH from being read as "clear these".
 */
function functionalFieldsOf(action: GrowthActionItem): GrowthAdminFunctionalActionFields | undefined {
  if (action.status !== "proposed") return undefined;
  const workflow = action.workflow;
  return {
    payload: action.payload,
    watchedMetrics: action.watchedMetrics,
    workflow: workflow == null ? null : { workflowId: workflow.workflowId, source: workflow.source, explanation: workflow.explanation, rollbackNote: workflow.rollbackNote },
  };
}

/**
 * The customer's own Growth workspace, wired to the admin API. Rendering the same component the
 * customer gets — rather than an admin-shaped mirror of it — is the point: an admin sees precisely
 * what the customer sees, and edits it where it sits.
 */
function GrowthAdminWorkspace(props: { app: object, project: GrowthAdminProject, overview: GrowthOverview, lifecycle: GrowthStatus, refresh: () => Promise<void> }) {
  const { app, refresh } = props;
  const [nowMillis] = useState(() => Date.now());
  const projectId = props.project.id;
  const editors = useMemo<GrowthWorkspaceEditors>(() => ({
    saveCategoryScore: async (category, score) => {
      await setGrowthAdminCategoryScore(app, projectId, category, score);
      await refresh();
    },
    saveItem: async (item, patch) => {
      if (item.kind === "finding") {
        const finding = item.value;
        const category = patch.category ?? finding.category
          ?? throwErr("Give this item a stage before editing its other fields — the Growth API stores findings per stage.");
        await updateGrowthAdminFinding(app, projectId, finding.id, {
          kind: finding.kind,
          category,
          tags: patch.tags ?? finding.tags,
          title: patch.title ?? finding.title,
          body: patch.body ?? finding.body,
        });
      } else {
        const action = item.value;
        const category = patch.category ?? action.category
          ?? throwErr("Give this action a stage before editing its other fields — the Growth API stores actions per stage.");
        await updateGrowthAdminAction(app, projectId, {
          ...action,
          category,
          tags: patch.tags ?? action.tags,
          title: patch.title ?? action.title,
          description: patch.body ?? action.description,
        }, functionalFieldsOf(action));
      }
      await refresh();
    },
    saveActionStatus: async (action, status) => {
      const category = action.category ?? throwErr("Give this action a stage before changing its status.");
      await updateGrowthAdminAction(app, projectId, { ...action, category, status }, functionalFieldsOf(action));
      await refresh();
    },
    createNote: async (input) => {
      await createGrowthAdminNote(app, projectId, { category: input.category, tags: [], title: input.title, body: input.body });
      await refresh();
    },
  }), [app, projectId, refresh]);

  // Until the interview is answered, the customer-facing content either doesn't exist yet (deep
  // research hasn't produced it) or is still being reshaped by the run, so the workspace renders
  // WITHOUT the edit provider — which is precisely what makes every field read-only, exactly as the
  // customer sees it. The interview review below stays live either way: it is the human gate that
  // unblocks everything downstream, and therefore the one thing staff should be acting on first.
  const gate = getGrowthAdminEditGate(props.lifecycle);

  const workspace = (
    <GrowthAdminCategoryPagesProvider app={app} projectId={projectId}>
      <GrowthWorkspaceContent
        overview={props.overview}
        status={props.lifecycle}
        projectId={projectId}
        projectName={props.project.displayName}
        // The admin page always edits a real project's records; there is no demo fixture mode here.
        demo={false}
        onRefresh={refresh}
        // Authoring a stage page out of research that doesn't exist yet would be writing fiction, so
        // the composer appears with the rest of the editing affordances.
        categoryPageEditor={gate.contentEditable
          ? (category) => (
            <GrowthAdminCategoryPageCard
              app={app}
              projectId={projectId}
              category={category}
              overview={props.overview}
              onPublishedChanged={refresh}
            />
          )
          : undefined}
      />
    </GrowthAdminCategoryPagesProvider>
  );

  // Lifecycle operations, which have no customer-facing surface to edit in place. A held interview
  // comes first: until it is released the customer cannot answer, and nothing downstream (report,
  // actions, briefs) can happen — it is the last human gate in the lifecycle.
  const operations = (
    <div className="space-y-4">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Lifecycle operations</h2>
      <GrowthAdminInterviewCard app={app} projectId={projectId} />
      <GrowthAdminReportsCard app={app} projectId={projectId} />
      <GrowthAdminGamesCard app={app} projectId={projectId} />
      <GrowthAdminActionInternalsCard app={app} projectId={projectId} actions={[...props.overview.actions, ...props.overview.archive]} onSaved={refresh} />
      <GrowthAdminRunNowCard app={app} projectId={projectId} projectName={props.project.displayName} onCompleted={refresh} />
    </div>
  );

  return (
    <div className="space-y-8">
      <GrowthAdminLifecycleCard status={props.lifecycle} gate={gate} nowMillis={nowMillis} />
      {/* While the content is read-only, the operations are the only thing worth acting on, so they
        * come first rather than below a workspace nobody can edit yet. */}
      {gate.contentEditable ? (
        <>
          <GrowthWorkspaceEditProvider editors={editors}>{workspace}</GrowthWorkspaceEditProvider>
          {operations}
        </>
      ) : (
        <>
          {operations}
          {workspace}
        </>
      )}
    </div>
  );
}

export default function PageClient() {
  useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const projectId = useProjectId();
  if (projectId !== "internal") throwErr("Growth Admin must be opened from the internal project.");
  const app = useStackApp();
  const [data, setData] = useState<Loadable>({ status: "loading" });
  const load = useCallback(async (selectedId?: string) => {
    try {
      const projects = await listGrowthAdminProjects(app);
      const selected = projects.find((project) => project.id === selectedId) ?? projects.at(0) ?? null;
      const [overview, lifecycle] = selected == null
        ? [null, null]
        : await Promise.all([getGrowthAdminOverview(app, selected.id), getGrowthAdminStatus(app, selected.id)]);
      setData({ status: "loaded", projects, selected, overview, lifecycle });
    } catch (error) {
      captureError("growth-admin-load", error);
      setData({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app]);
  useEffect(() => runAsynchronously(load()), [load]);
  const loadedSelectedId = data.status === "loaded" ? data.selected?.id : undefined;
  const refresh = useCallback(async () => await load(loadedSelectedId), [load, loadedSelectedId]);
  return (
    <PageLayout
      allowContentOverflow
      width={1600}
      title="Growth Admin"
      description="The customer's own Growth workspace, with every field editable — without bypassing domain lifecycle rules"
    >
      {data.status === "loading" ? <div className="h-72 animate-pulse rounded-2xl border bg-foreground/[0.03]" />
        : data.status === "error" ? <DesignAlert variant="error"><div className="flex justify-between gap-3"><span>{data.message}</span><DesignButton onClick={() => load()}>Retry</DesignButton></div></DesignAlert>
          : data.selected == null || data.overview == null || data.lifecycle == null ? <DesignAlert>No completed Growth onboarding records were found.</DesignAlert>
            : (
              <div className="space-y-8">
                <DesignSelectorDropdown
                  value={data.selected.id}
                  onValueChange={(value) => {
                    setData({ status: "loading" });
                    runAsynchronously(load(value));
                  }}
                  options={data.projects.map((project) => ({ value: project.id, label: project.displayName }))}
                />
                <GrowthAdminWorkspace app={app} project={data.selected} overview={data.overview} lifecycle={data.lifecycle} refresh={refresh} />
              </div>
            )}
    </PageLayout>
  );
}
