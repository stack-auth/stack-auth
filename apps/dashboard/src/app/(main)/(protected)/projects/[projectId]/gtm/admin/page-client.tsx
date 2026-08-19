"use client";

import { DesignAlert, DesignButton, DesignCard, DesignInput, DesignSelectorDropdown } from "@/components/design-components";
import { getGrowthAdminOverview, listGrowthAdminProjects, createGrowthAdminNote, setGrowthAdminCategoryScore, updateGrowthAdminAction, updateGrowthAdminFinding, type GrowthAdminProject } from "@/lib/growth/growth-api";
import { GROWTH_ACTION_STATUSES, GROWTH_ACTION_TYPES, GROWTH_CATEGORIES, type GrowthActionItem, type GrowthActionStatus, type GrowthActionType, type GrowthCategory, type GrowthOverview } from "@/lib/growth/growth-types";
import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useStackApp, useUser } from "@hexclave/next";
import { ListChecksIcon, NotePencilIcon, SlidersHorizontalIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { PageLayout } from "../../page-layout";
import { useProjectId } from "../../use-admin-app";
import { GrowthWorkspaceContent } from "../components/workspace-overview";
import { GrowthAdminGamesCard } from "./games-card";
import { GrowthAdminInterviewCard } from "./interview-card";
import { GrowthAdminReportsCard } from "./reports-card";
import { GrowthAdminRunNowCard } from "./run-now-card";

type Loadable = { status: "loading" } | { status: "error", message: string } | { status: "loaded", projects: GrowthAdminProject[], selected: GrowthAdminProject | null, overview: GrowthOverview | null };

function growthCategory(value: string): GrowthCategory {
  return GROWTH_CATEGORIES.find((category) => category === value) ?? throwErr(`Unknown Growth category: ${value}`);
}

function growthActionType(value: string): GrowthActionType {
  return GROWTH_ACTION_TYPES.find((type) => type === value) ?? throwErr(`Unknown Growth action type: ${value}`);
}

function growthActionStatus(value: string): GrowthActionStatus {
  return GROWTH_ACTION_STATUSES.find((status) => status === value) ?? throwErr(`Unknown Growth action status: ${value}`);
}

function validAdminStatuses(currentStatus: GrowthActionStatus): GrowthActionStatus[] {
  if (currentStatus === "proposed") return ["proposed", "active", "dismissed"];
  if (currentStatus === "active") return ["active", "dismissed"];
  return [currentStatus];
}

const watchedMetricsSchema = z.array(z.object({ metricId: z.enum(["new_signups", "returning_users", "transactions", "emails_sent", "total_users", "revenue"]), windowDays: z.number().int().min(1).max(90) })).max(10);
const workflowSchema = z.object({ workflowId: z.string().min(1).max(64), source: z.string().min(1), explanation: z.string().min(1).max(5000), rollbackNote: z.string().min(1).max(5000) }).nullable();

function workflowJson(action: GrowthActionItem | null): string {
  if (action?.workflow == null) return "null";
  const { workflowId, source, explanation, rollbackNote } = action.workflow;
  return JSON.stringify({ workflowId, source, explanation, rollbackNote }, null, 2);
}

function AdminEditor(props: { app: object, project: GrowthAdminProject, overview: GrowthOverview, refresh: () => Promise<void> }) {
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteCategory, setNoteCategory] = useState<GrowthCategory>("reach");
  const [noteTags, setNoteTags] = useState("");
  const [selectedActionId, setSelectedActionId] = useState(props.overview.actions.at(0)?.id ?? props.overview.archive.at(0)?.id ?? "");
  const selectedAction = [...props.overview.actions, ...props.overview.archive].find((item) => item.id === selectedActionId) ?? null;
  const [actionDraft, setActionDraft] = useState<GrowthActionItem | null>(selectedAction);
  const [payloadJson, setPayloadJson] = useState(() => selectedAction?.payload == null ? "null" : JSON.stringify(selectedAction.payload, null, 2));
  const [watchedJson, setWatchedJson] = useState(() => JSON.stringify(selectedAction?.watchedMetrics ?? [], null, 2));
  const [workflowDraftJson, setWorkflowDraftJson] = useState(() => workflowJson(selectedAction));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setActionDraft(selectedAction);
    setPayloadJson(selectedAction?.payload == null ? "null" : JSON.stringify(selectedAction.payload, null, 2));
    setWatchedJson(JSON.stringify(selectedAction?.watchedMetrics ?? [], null, 2));
    setWorkflowDraftJson(workflowJson(selectedAction));
  }, [selectedAction]);

  const allUnclassified = [...props.overview.findings, ...props.overview.notes].filter((item) => item.category == null);
  const unclassifiedActions = [...props.overview.actions, ...props.overview.archive].filter((item) => item.category == null);
  const runAdminMutation = (label: string, mutation: () => Promise<void>) => {
    setError(null);
    runAsynchronously((async () => {
      try {
        await mutation();
        await props.refresh();
      } catch (caught) {
        captureError(label, caught);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })());
  };
  return (
    <div className="space-y-4">
      {error != null && <DesignAlert variant="error">{error}</DesignAlert>}
      {/* First: a held interview is a customer sitting still — until it is released they cannot
        * answer, and nothing downstream (report, actions, briefs) can happen. It is the only
        * remaining human gate in the lifecycle, and therefore the most consequential thing here. */}
      <GrowthAdminInterviewCard app={props.app} projectId={props.project.id} />
      <GrowthAdminReportsCard app={props.app} projectId={props.project.id} />
      <GrowthAdminGamesCard app={props.app} projectId={props.project.id} />
      <GrowthAdminRunNowCard app={props.app} />

      <DesignCard title="Stage scores" subtitle="Manual 0–100 values used by the customer growth journey" icon={SlidersHorizontalIcon} gradient="purple">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {props.overview.categories.map((item) => <label key={item.category} className="flex items-center gap-2 rounded-xl border p-3 text-sm"><span className="min-w-24 capitalize">{item.category}</span><DesignInput className="w-20" type="number" min={0} max={100} defaultValue={item.score ?? ""} onBlur={(event) => {
            const score = event.target.value;
            if (score === "") return;
              runAdminMutation("growth-admin-score", () => setGrowthAdminCategoryScore(props.app, props.project.id, item.category, Number(score)));
          }} /></label>)}
        </div>
      </DesignCard>

      {(allUnclassified.length > 0 || unclassifiedActions.length > 0) && <DesignCard title={`Needs category (${allUnclassified.length + unclassifiedActions.length})`} subtitle="Classify legacy Growth records before the final constraint migration" icon={ListChecksIcon} gradient="orange">
        <div className="space-y-3">
          {allUnclassified.map((finding) => <div key={finding.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-medium">{finding.title}</p><p className="text-xs text-muted-foreground">Finding · {finding.kind}</p></div><DesignSelectorDropdown value="" placeholder="Choose category" options={GROWTH_CATEGORIES.map((category) => ({ value: category, label: category }))} onValueChange={(category) => runAdminMutation("growth-admin-classify-finding", () => updateGrowthAdminFinding(props.app, props.project.id, finding.id, { kind: finding.kind, category, tags: finding.tags, title: finding.title, body: finding.body }))} /></div>)}
          {unclassifiedActions.map((action) => <div key={action.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p className="text-sm font-medium">{action.title}</p><p className="text-xs text-muted-foreground">Action · {action.status}</p></div><DesignSelectorDropdown value="" placeholder="Choose category" options={GROWTH_CATEGORIES.map((category) => ({ value: category, label: category }))} onValueChange={(category) => runAdminMutation("growth-admin-classify-action", () => updateGrowthAdminAction(props.app, props.project.id, { ...action, category: growthCategory(category) }, action.status === "proposed" ? { payload: action.payload, watchedMetrics: action.watchedMetrics, workflow: action.workflow } : undefined))} /></div>)}
        </div>
      </DesignCard>}

      <DesignCard title="Add admin note" subtitle="Notes are Growth findings with source admin and kind note" icon={NotePencilIcon} gradient="blue">
        <div className="grid gap-3 sm:grid-cols-2"><DesignInput placeholder="Note title" value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} /><DesignSelectorDropdown value={noteCategory} onValueChange={(value) => setNoteCategory(growthCategory(value))} options={GROWTH_CATEGORIES.map((category) => ({ value: category, label: category }))} /><DesignInput placeholder="Tags, comma separated" value={noteTags} onChange={(event) => setNoteTags(event.target.value)} /><textarea className="min-h-24 rounded-xl border bg-background p-3 text-sm sm:col-span-2" placeholder="Note" value={noteBody} onChange={(event) => setNoteBody(event.target.value)} /></div>
        <DesignButton className="mt-3" onClick={async () => {
          setError(null);
          try {
            await createGrowthAdminNote(props.app, props.project.id, {
              category: noteCategory,
              tags: noteTags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0),
              title: noteTitle,
              body: noteBody,
            });
            setNoteTitle("");
            setNoteBody("");
            setNoteTags("");
            await props.refresh();
          } catch (caught) {
            captureError("growth-admin-note", caught);
            setError(caught instanceof Error ? caught.message : String(caught));
          }
        }}>Add note</DesignButton>
      </DesignCard>

      <DesignCard title="Action editor" subtitle="Proposals allow functional edits; active and terminal rows obey lifecycle restrictions" icon={ListChecksIcon} gradient="cyan">
        {[...props.overview.actions, ...props.overview.archive].length === 0 ? <p className="text-sm text-muted-foreground">No actions yet.</p> : <div className="space-y-3">
          <DesignSelectorDropdown value={selectedActionId} onValueChange={setSelectedActionId} options={[...props.overview.actions, ...props.overview.archive].map((action) => ({ value: action.id, label: action.title }))} />
          {actionDraft != null && <>
            <div className="grid gap-3 sm:grid-cols-2"><DesignInput value={actionDraft.title} onChange={(event) => setActionDraft({ ...actionDraft, title: event.target.value })} /><DesignSelectorDropdown value={actionDraft.typeId} disabled={selectedAction?.status !== "proposed"} onValueChange={(value) => setActionDraft({ ...actionDraft, typeId: growthActionType(value) })} options={GROWTH_ACTION_TYPES.map((type) => ({ value: type, label: type }))} /><DesignSelectorDropdown value={actionDraft.category ?? ""} placeholder="Category" onValueChange={(value) => setActionDraft({ ...actionDraft, category: growthCategory(value) })} options={GROWTH_CATEGORIES.map((category) => ({ value: category, label: category }))} /><DesignSelectorDropdown value={actionDraft.status} onValueChange={(value) => setActionDraft({ ...actionDraft, status: growthActionStatus(value) })} options={validAdminStatuses(selectedAction?.status ?? actionDraft.status).map((status) => ({ value: status, label: status }))} /><DesignInput value={actionDraft.tags.join(", ")} onChange={(event) => setActionDraft({ ...actionDraft, tags: event.target.value.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0) })} /><textarea className="min-h-24 rounded-xl border bg-background p-3 text-sm sm:col-span-2" value={actionDraft.description} onChange={(event) => setActionDraft({ ...actionDraft, description: event.target.value })} /><label className="text-xs font-medium">Payload JSON<textarea disabled={selectedAction?.status !== "proposed"} className="mt-1 min-h-40 w-full rounded-xl border bg-background p-3 font-mono text-xs disabled:opacity-60" value={payloadJson} onChange={(event) => setPayloadJson(event.target.value)} /></label><label className="text-xs font-medium">Watched metrics JSON<textarea disabled={selectedAction?.status !== "proposed"} className="mt-1 min-h-40 w-full rounded-xl border bg-background p-3 font-mono text-xs disabled:opacity-60" value={watchedJson} onChange={(event) => setWatchedJson(event.target.value)} /></label><label className="text-xs font-medium sm:col-span-2">Workflow JSON · null removes a proposed workflow<textarea disabled={selectedAction?.status !== "proposed"} className="mt-1 min-h-52 w-full rounded-xl border bg-background p-3 font-mono text-xs disabled:opacity-60" value={workflowDraftJson} onChange={(event) => setWorkflowDraftJson(event.target.value)} /></label></div>
            {selectedAction?.status === "proposed" && actionDraft.status === "active" && <DesignAlert>Saving activates this proposal through the Growth lifecycle. A valid ads proposal can create a paused campaign for review.</DesignAlert>}
            <DesignButton onClick={async () => {
              setError(null);
              try {
                if (actionDraft.category == null) throw new Error("Choose a category before saving.");
                // Functional fields are immutable after activation (the backend rejects them), so they
                // are only sent while the item is still proposed.
                const functionalFields = selectedAction?.status === "proposed" ? {
                  payload: z.unknown().parse(JSON.parse(payloadJson)),
                  watchedMetrics: watchedMetricsSchema.parse(JSON.parse(watchedJson)),
                  workflow: workflowSchema.parse(JSON.parse(workflowDraftJson)),
                } : undefined;
                await updateGrowthAdminAction(props.app, props.project.id, actionDraft, functionalFields);
                await props.refresh();
              } catch (caught) {
                captureError("growth-admin-action", caught);
                setError(caught instanceof Error ? caught.message : String(caught));
              }
            }}>Save action</DesignButton>
          </>}
        </div>}
      </DesignCard>
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
      const overview = selected == null ? null : await getGrowthAdminOverview(app, selected.id);
      setData({ status: "loaded", projects, selected, overview });
    } catch (error) {
      captureError("growth-admin-load", error);
      setData({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [app]);
  useEffect(() => runAsynchronously(load()), [load]);
  const loadedSelectedId = data.status === "loaded" ? data.selected?.id : undefined;
  return <PageLayout allowContentOverflow width={1600} title="Growth Admin" description="Edit customer Growth workspaces without bypassing domain lifecycle rules">
    {data.status === "loading" ? <div className="h-72 animate-pulse rounded-2xl border bg-foreground/[0.03]" /> : data.status === "error" ? <DesignAlert variant="error"><div className="flex justify-between gap-3"><span>{data.message}</span><DesignButton onClick={() => load()}>Retry</DesignButton></div></DesignAlert> : data.selected == null || data.overview == null ? <DesignAlert>No completed Growth onboarding records were found.</DesignAlert> : <div className="space-y-8"><DesignSelectorDropdown value={data.selected.id} onValueChange={(value) => {
      setData({ status: "loading" });
      runAsynchronously(load(value));
    }} options={data.projects.map((project) => ({ value: project.id, label: project.displayName }))} /><AdminEditor app={app} project={data.selected} overview={data.overview} refresh={() => load(loadedSelectedId)} /><GrowthWorkspaceContent overview={data.overview} projectId={data.selected.id} projectName={data.selected.displayName} /></div>}
  </PageLayout>;
}
