"use client";

import { AppEnabledGuard } from "../../app-enabled-guard";
import { PageLayout } from "../../page-layout";
import { useProjectId } from "../../use-admin-app";
import {
  DesignAlert,
  DesignButton,
  DesignDialog,
  DesignInput,
  DesignSelectorDropdown as BaseDesignSelectorDropdown,
} from "@/components/design-components";
import { useRouterConfirm } from "@/components/router";
import { Textarea } from "@/components/ui";
import {
  createAction,
  createInsight,
  createNote,
  deleteAction as deleteActionRequest,
  deleteInsight as deleteInsightRequest,
  deleteNote as deleteNoteRequest,
  listGtmOnboardedProjects,
  updateAction,
  updateInsight,
  updateNote,
  type GtmActionDraft,
  type GtmInsightDraft,
  type GtmNoteDraft,
  type GtmOnboardedProject,
} from "@/lib/gtm/gtm-api";
import { GtmDataProvider, useGtmData } from "@/lib/gtm/gtm-data";
import {
  GTM_ACTION_STATUSES,
  GTM_ACTION_TYPES,
  GTM_CONFIDENCES,
  GTM_DOMAINS,
  GTM_INSIGHT_KINDS,
  GTM_INSIGHT_STATUSES,
  GTM_NOTE_CATEGORIES,
  GTM_NOTE_SOURCES,
  GTM_VERDICTS,
  type GtmAction,
  type GtmDomainId,
  type GtmInsight,
  type GtmNote,
} from "@/lib/gtm/gtm-types";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useStackApp, useUser } from "@hexclave/next";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { GtmAdminControlsProvider, type GtmAdminControls } from "../components/admin-context";
import { GTM_DOMAIN_PRESENTATIONS } from "../components/domains";
import { GtmActionMenu, type GtmActionMenuItem } from "../components/nested-action-menu";
import { GtmOverview } from "../components/overview";

type EditorProps = {
  app: object,
  targetProjectId: string,
  onSaved: () => Promise<void>,
  onDeleted: () => Promise<void>,
  onDirtyChange: (dirty: boolean) => void,
  newDomain: GtmDomainId | null,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNonEmpty<T>(items: T[]): items is [T, ...T[]] {
  return items.length > 0;
}

function requireNewDomain(domain: GtmDomainId | null, recordType: string): GtmDomainId {
  if (domain == null) throw new Error(`A new GTM ${recordType} requires a domain.`);
  return domain;
}

function selectorOptions<const Value extends string>(values: readonly Value[]) {
  return values.map((value) => ({
    value,
    label: value.replaceAll("_", " "),
  }));
}

function DesignSelectorDropdown<const Value extends string>(props: {
  value: Value,
  onValueChange: (value: Value) => void,
  options: { value: Value, label: string }[],
}) {
  return (
    <BaseDesignSelectorDropdown
      value={props.value}
      options={props.options}
      onValueChange={(value) => {
        const selected = props.options.find((option) => option.value === value);
        if (selected == null) throw new Error(`The selector returned an unknown value: ${value}`);
        props.onValueChange(selected.value);
      }}
    />
  );
}

function toDateTimeLocal(millis: number | null): string {
  if (millis == null) return "";
  const date = new Date(millis);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeLocal(value: string): number | null {
  return value.length === 0 ? null : new Date(value).getTime();
}

async function deleteInsight(app: object, value: GtmInsight | null, targetProjectId: string): Promise<void> {
  if (value == null) throw new Error("Cannot delete an insight without a selected record.");
  await deleteInsightRequest(app, value, targetProjectId);
}

async function deleteAction(app: object, value: GtmAction | null, targetProjectId: string): Promise<void> {
  if (value == null) throw new Error("Cannot delete an action without a selected record.");
  await deleteActionRequest(app, value, targetProjectId);
}

async function deleteNote(app: object, value: GtmNote | null, targetProjectId: string): Promise<void> {
  if (value == null) throw new Error("Cannot delete a note without a selected record.");
  await deleteNoteRequest(app, value, targetProjectId);
}

function DeleteDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  label: string,
  onDelete: () => Promise<void>,
}) {
  return (
    <DesignDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="sm"
      title={`Delete ${props.label}?`}
      description="This removes the record from the internal GTM dashboard. This cannot be undone."
      footer={(
        <>
          <DesignButton variant="outline" onClick={() => props.onOpenChange(false)}>
            Cancel
          </DesignButton>
          <DesignButton variant="destructive" onClick={props.onDelete}>
            Delete
          </DesignButton>
        </>
      )}
    >
      <DesignAlert
        variant="warning"
        title="Permanent deletion"
        description="Other GTM records are not changed."
      />
    </DesignDialog>
  );
}

function EditorHeader(props: { eyebrow: string, title: string, onDelete?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.eyebrow}</p>
        <h3 className="mt-1 text-lg font-semibold">{props.title}</h3>
      </div>
      {props.onDelete != null && (
        <DesignButton variant="plain" size="icon" aria-label={`Delete ${props.eyebrow.toLowerCase()}`} onClick={props.onDelete}>
          <TrashIcon className="h-4 w-4" />
        </DesignButton>
      )}
    </div>
  );
}

function InsightEditor(props: EditorProps & { value: GtmInsight | null }) {
  const { onDirtyChange } = props;
  const [draft, setDraft] = useState<GtmInsightDraft>(() => props.value == null
    ? {
      domain: requireNewDomain(props.newDomain, "suggestion"),
      kind: "data_gap",
      status: "new",
      confidence: "medium",
      title: "",
      body: "",
      impactScore: 0,
      timesSeen: 1,
    }
    : props.value);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirty = props.value == null || JSON.stringify(draft) !== JSON.stringify({
    domain: props.value.domain,
    kind: props.value.kind,
    status: props.value.status,
    confidence: props.value.confidence,
    title: props.value.title,
    body: props.value.body,
    impactScore: props.value.impactScore,
    timesSeen: props.value.timesSeen,
  });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setError(null);
    try {
      if (props.value == null) {
        await createInsight(props.app, draft, props.targetProjectId);
      } else {
        await updateInsight(props.app, { ...props.value, ...draft }, props.targetProjectId);
      }
      props.onDirtyChange(false);
      await props.onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const remove = async () => {
    try {
      await deleteInsight(props.app, props.value, props.targetProjectId);
      props.onDirtyChange(false);
      await props.onDeleted();
    } catch (deleteError) {
      setDeleteOpen(false);
      setError(errorMessage(deleteError));
    }
  };

  return (
    <div className="space-y-4">
      <EditorHeader
        eyebrow="Suggestion"
        title={props.value == null ? "New suggestion" : props.value.title}
        onDelete={props.value == null ? undefined : () => setDeleteOpen(true)}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DesignSelectorDropdown
          value={draft.domain}
          onValueChange={(domain) => setDraft({ ...draft, domain })}
          options={selectorOptions(GTM_DOMAINS)}
        />
        <DesignSelectorDropdown
          value={draft.kind}
          onValueChange={(kind) => setDraft({ ...draft, kind })}
          options={selectorOptions(GTM_INSIGHT_KINDS)}
        />
        <DesignSelectorDropdown
          value={draft.status}
          onValueChange={(status) => setDraft({ ...draft, status })}
          options={selectorOptions(GTM_INSIGHT_STATUSES)}
        />
        <DesignSelectorDropdown
          value={draft.confidence}
          onValueChange={(confidence) => setDraft({ ...draft, confidence })}
          options={selectorOptions(GTM_CONFIDENCES)}
        />
      </div>
      <DesignInput
        value={draft.title}
        maxLength={200}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Suggestion title"
      />
      <Textarea
        value={draft.body}
        maxLength={5000}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        className="min-h-32"
        placeholder="What did we learn?"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <DesignInput
          type="number"
          min={0}
          max={100}
          value={draft.impactScore}
          onChange={(event) => setDraft({ ...draft, impactScore: Number(event.target.value) })}
          aria-label="Impact score"
        />
        <DesignInput
          type="number"
          min={1}
          value={draft.timesSeen}
          onChange={(event) => setDraft({ ...draft, timesSeen: Number(event.target.value) })}
          aria-label="Times seen"
        />
      </div>
      {error != null && <DesignAlert variant="error" title="Could not save suggestion" description={error} />}
      <DesignButton onClick={save}>Save suggestion</DesignButton>
      {props.value != null && (
        <DeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          label="suggestion"
          onDelete={remove}
        />
      )}
    </div>
  );
}

function ActionEditor(props: EditorProps & { value: GtmAction | null }) {
  const { onDirtyChange } = props;
  const [draft, setDraft] = useState<GtmActionDraft>(() => props.value == null
    ? {
      domain: requireNewDomain(props.newDomain, "action"),
      type: "broadcast_email",
      status: "proposed",
      title: "",
      summary: "",
      verdict: null,
      retrospective: null,
      expiresAtMillis: new Date().getTime() + 14 * 24 * 60 * 60 * 1000,
      executedAtMillis: null,
    }
    : props.value);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirty = props.value == null || JSON.stringify(draft) !== JSON.stringify({
    domain: props.value.domain,
    type: props.value.type,
    status: props.value.status,
    title: props.value.title,
    summary: props.value.summary,
    verdict: props.value.verdict,
    retrospective: props.value.retrospective,
    expiresAtMillis: props.value.expiresAtMillis,
    executedAtMillis: props.value.executedAtMillis,
  });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setError(null);
    try {
      if (props.value == null) {
        await createAction(props.app, draft, props.targetProjectId);
      } else {
        await updateAction(props.app, { ...props.value, ...draft }, props.targetProjectId);
      }
      props.onDirtyChange(false);
      await props.onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const remove = async () => {
    try {
      await deleteAction(props.app, props.value, props.targetProjectId);
      props.onDirtyChange(false);
      await props.onDeleted();
    } catch (deleteError) {
      setDeleteOpen(false);
      setError(errorMessage(deleteError));
    }
  };

  return (
    <div className="space-y-4">
      <EditorHeader
        eyebrow="Action"
        title={props.value == null ? "New action" : props.value.title}
        onDelete={props.value == null ? undefined : () => setDeleteOpen(true)}
      />
      <DesignAlert
        variant="info"
        title="Inert record"
        description="Saving this action never sends email, changes configuration, or performs an external effect."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <DesignSelectorDropdown
          value={draft.domain}
          onValueChange={(domain) => setDraft({ ...draft, domain })}
          options={selectorOptions(GTM_DOMAINS)}
        />
        <DesignSelectorDropdown
          value={draft.type}
          onValueChange={(type) => setDraft({ ...draft, type })}
          options={selectorOptions(GTM_ACTION_TYPES)}
        />
        <DesignSelectorDropdown
          value={draft.status}
          onValueChange={(status) => setDraft({ ...draft, status })}
          options={selectorOptions(GTM_ACTION_STATUSES)}
        />
      </div>
      <DesignInput
        value={draft.title}
        maxLength={200}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Action title"
      />
      <Textarea
        value={draft.summary}
        maxLength={2000}
        onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
        className="min-h-28"
        placeholder="What is the recorded action?"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <DesignSelectorDropdown
          value={draft.verdict ?? "none"}
          onValueChange={(verdict) => setDraft({ ...draft, verdict: verdict === "none" ? null : verdict })}
          options={[{ value: "none", label: "No verdict" }, ...selectorOptions(GTM_VERDICTS)]}
        />
        <DesignInput
          type="datetime-local"
          value={toDateTimeLocal(draft.expiresAtMillis)}
          onChange={(event) => setDraft({
            ...draft,
            expiresAtMillis: fromDateTimeLocal(event.target.value) ?? draft.expiresAtMillis,
          })}
          aria-label="Expires at"
        />
      </div>
      <Textarea
        value={draft.retrospective ?? ""}
        maxLength={5000}
        onChange={(event) => setDraft({
          ...draft,
          retrospective: event.target.value.length === 0 ? null : event.target.value,
        })}
        className="min-h-24"
        placeholder="Optional retrospective"
      />
      {error != null && <DesignAlert variant="error" title="Could not save action" description={error} />}
      <DesignButton onClick={save}>Save action</DesignButton>
      {props.value != null && (
        <DeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          label="action"
          onDelete={remove}
        />
      )}
    </div>
  );
}

function NoteEditor(props: EditorProps & { value: GtmNote | null }) {
  const { onDirtyChange } = props;
  const [draft, setDraft] = useState<GtmNoteDraft>(() => props.value == null
    ? {
      domain: requireNewDomain(props.newDomain, "note"),
      category: "company",
      title: "",
      body: "",
      source: "user",
    }
    : { ...props.value, title: props.value.title ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dirty = props.value == null || JSON.stringify(draft) !== JSON.stringify({
    domain: props.value.domain,
    category: props.value.category,
    title: props.value.title ?? "",
    body: props.value.body,
    source: props.value.source,
  });

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = async () => {
    setError(null);
    if (draft.title.trim().length === 0) {
      setError("Add a title before saving this note.");
      return;
    }
    try {
      if (props.value == null) {
        await createNote(props.app, draft, props.targetProjectId);
      } else {
        await updateNote(props.app, { ...props.value, ...draft }, props.targetProjectId);
      }
      props.onDirtyChange(false);
      await props.onSaved();
    } catch (saveError) {
      setError(errorMessage(saveError));
    }
  };

  const remove = async () => {
    try {
      await deleteNote(props.app, props.value, props.targetProjectId);
      props.onDirtyChange(false);
      await props.onDeleted();
    } catch (deleteError) {
      setDeleteOpen(false);
      setError(errorMessage(deleteError));
    }
  };

  return (
    <div className="space-y-4">
      <EditorHeader
        eyebrow="Note"
        title={props.value == null ? "New note" : props.value.title ?? "Untitled note"}
        onDelete={props.value == null ? undefined : () => setDeleteOpen(true)}
      />
      <DesignInput
        value={draft.title}
        maxLength={120}
        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        placeholder="Note title"
        aria-label="Note title"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <DesignSelectorDropdown
          value={draft.domain}
          onValueChange={(domain) => setDraft({ ...draft, domain })}
          options={selectorOptions(GTM_DOMAINS)}
        />
        <DesignSelectorDropdown
          value={draft.category}
          onValueChange={(category) => setDraft({ ...draft, category })}
          options={selectorOptions(GTM_NOTE_CATEGORIES)}
        />
        <DesignSelectorDropdown
          value={draft.source}
          onValueChange={(source) => setDraft({ ...draft, source })}
          options={selectorOptions(GTM_NOTE_SOURCES)}
        />
      </div>
      <Textarea
        value={draft.body}
        maxLength={500}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        className="min-h-36"
        placeholder="Durable context for the GTM workspace"
      />
      {error != null && <DesignAlert variant="error" title="Could not save note" description={error} />}
      <DesignButton onClick={save}>Save note</DesignButton>
      {props.value != null && (
        <DeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          label="note"
          onDelete={remove}
        />
      )}
    </div>
  );
}

type EditorTarget =
  | { type: "insight", value: GtmInsight, domain?: never }
  | { type: "insight", value: null, domain: GtmDomainId }
  | { type: "action", value: GtmAction, domain?: never }
  | { type: "action", value: null, domain: GtmDomainId }
  | { type: "note", value: GtmNote, domain?: never }
  | { type: "note", value: null, domain: GtmDomainId };

function editorTitle(target: EditorTarget): string {
  const label = target.type === "insight" ? "suggestion" : target.type;
  return `${target.value == null ? "Add" : "Edit"} ${label}`;
}

function AdminEditorDialog(props: {
  app: object,
  targetProjectId: string,
  target: EditorTarget,
  onClose: () => void,
  onSaved: () => Promise<void>,
  onDeleted: () => Promise<void>,
  onDirtyChange: (dirty: boolean) => void,
}) {
  const editorProps = {
    app: props.app,
    targetProjectId: props.targetProjectId,
    onSaved: props.onSaved,
    onDeleted: props.onDeleted,
    onDirtyChange: props.onDirtyChange,
    newDomain: props.target.value == null ? props.target.domain : null,
  };
  return (
    <DesignDialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="lg"
      title={editorTitle(props.target)}
      description="Changes appear immediately in this internal GTM view after saving."
    >
      {props.target.type === "insight"
        ? <InsightEditor {...editorProps} value={props.target.value} />
        : props.target.type === "action"
          ? <ActionEditor {...editorProps} value={props.target.value} />
          : <NoteEditor {...editorProps} value={props.target.value} />}
    </DesignDialog>
  );
}

function AdminOverview(props: { targetProjectId: string, targetProjectName: string, onTargetProjectChange: (projectId: string) => void, projects: { id: string, displayName: string }[] }) {
  const app = useStackApp();
  const { data, refresh } = useGtmData();
  const { setNeedConfirm } = useRouterConfirm();
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setNeedConfirm(dirty);
    return () => setNeedConfirm(false);
  }, [dirty, setNeedConfirm]);

  const openEditor = useCallback((nextTarget: EditorTarget) => {
    if (dirty && !window.confirm("Discard the unsaved GTM changes?")) return;
    setDirty(false);
    setTarget(nextTarget);
  }, [dirty]);
  const closeEditor = () => {
    if (dirty && !window.confirm("Discard the unsaved GTM changes?")) return;
    setDirty(false);
    setTarget(null);
  };
  const finishMutation = async () => {
    setDirty(false);
    setTarget(null);
    await refresh();
  };
  const controls = useMemo<GtmAdminControls>(() => ({
    editInsight: (insight) => openEditor({ type: "insight", value: insight }),
    editAction: (action) => openEditor({ type: "action", value: action }),
    editNote: (note) => openEditor({ type: "note", value: note }),
  }), [openEditor]);

  const counts = data.status === "loaded"
    ? `${data.value.insights.length + data.value.actions.length} suggestions · ${data.value.notes.length} notes`
    : "Loading records";
  const addItems = GTM_DOMAIN_PRESENTATIONS.map((domain): GtmActionMenuItem => {
    const DomainIcon = domain.icon;
    return {
      id: domain.id,
      label: domain.label,
      icon: <DomainIcon className="h-4 w-4" />,
      items: [
        {
          id: `${domain.id}-suggestion`,
          label: "Suggestion",
          onClick: () => openEditor({ type: "insight", value: null, domain: domain.id }),
        },
        {
          id: `${domain.id}-note`,
          label: "Note",
          onClick: () => openEditor({ type: "note", value: null, domain: domain.id }),
        },
      ],
    };
  });
  const toolbar = (
    <div className="flex flex-col gap-3 rounded-xl border border-foreground/[0.1] bg-foreground/[0.025] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">Editing {props.targetProjectName}’s live overview</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{counts}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <DesignSelectorDropdown
          value={props.targetProjectId}
          onValueChange={props.onTargetProjectChange}
          options={props.projects.map((project) => ({ value: project.id, label: project.displayName }))}
        />
        <GtmActionMenu
          trigger="icon"
          triggerLabel="Add GTM record"
          triggerIcon={<PlusIcon className="h-4 w-4" />}
          align="end"
          label="Choose a domain"
          withIcons
          items={addItems}
        />
      </div>
    </div>
  );

  return (
    <GtmAdminControlsProvider value={controls}>
      <GtmOverview
        toolbar={toolbar}
        project={{ id: props.targetProjectId, displayName: props.targetProjectName }}
      />
      {target != null && (
        <AdminEditorDialog
          app={app}
          targetProjectId={props.targetProjectId}
          target={target}
          onClose={closeEditor}
          onSaved={finishMutation}
          onDeleted={finishMutation}
          onDirtyChange={setDirty}
        />
      )}
    </GtmAdminControlsProvider>
  );
}

export default function PageClient() {
  const projectId = useProjectId();
  if (projectId !== "internal") {
    notFound();
  }
  return <InternalGtmAdminPage />;
}

function InternalGtmAdminPage() {
  useUser({ or: "redirect", projectIdMustMatch: "internal" });
  const app = useStackApp();
  const [projectsState, setProjectsState] = useState<
    | { status: "loading" }
    | { status: "error", message: string }
    | { status: "loaded", projects: GtmOnboardedProject[] }
  >({ status: "loading" });

  const loadProjects = useCallback(async () => {
    setProjectsState({ status: "loading" });
    try {
      setProjectsState({ status: "loaded", projects: await listGtmOnboardedProjects(app) });
    } catch (error) {
      captureError("gtm-onboarded-projects-load", error);
      setProjectsState({ status: "error", message: errorMessage(error) });
    }
  }, [app]);

  useEffect(() => {
    runAsynchronously(loadProjects());
  }, [loadProjects]);

  return (
    <AppEnabledGuard appId="gtm">
      {projectsState.status === "loading" ? (
        <PageLayout>
          <DesignAlert variant="info" title="Loading GTM projects" description="Finding projects that completed GTM onboarding." />
        </PageLayout>
      ) : projectsState.status === "error" ? (
        <PageLayout>
          <DesignAlert variant="error" title="Could not load GTM projects" description={projectsState.message} />
          <DesignButton variant="secondary" onClick={loadProjects}>Try again</DesignButton>
        </PageLayout>
      ) : !isNonEmpty(projectsState.projects) ? (
        <PageLayout>
          <DesignAlert
            variant="info"
            title="No onboarded GTM projects"
            description="Projects will appear here after their GTM onboarding details are submitted."
          />
        </PageLayout>
      ) : (
        <LoadedInternalGtmAdminPage projects={projectsState.projects} />
      )}
    </AppEnabledGuard>
  );
}

function LoadedInternalGtmAdminPage(props: { projects: [GtmOnboardedProject, ...GtmOnboardedProject[]] }) {
  const firstProject = props.projects[0];
  const [targetProjectId, setTargetProjectId] = useState(firstProject.id);
  const restoredProjectFromUrl = useRef(false);
  useEffect(() => {
    if (!restoredProjectFromUrl.current) {
      restoredProjectFromUrl.current = true;
      const requestedProjectId = new URLSearchParams(window.location.search).get("project_id");
      if (requestedProjectId != null && props.projects.some((project) => project.id === requestedProjectId)) {
        setTargetProjectId(requestedProjectId);
        return;
      }
    }
    if (props.projects.some((project) => project.id === targetProjectId)) return;
    setTargetProjectId(firstProject.id);
  }, [firstProject.id, props.projects, targetProjectId]);
  const targetProject = props.projects.find((project) => project.id === targetProjectId) ?? firstProject;
  return (
    <GtmDataProvider key={targetProject.id} demo={false} projectId={targetProject.id}>
      <AdminOverview
        targetProjectId={targetProject.id}
        targetProjectName={targetProject.displayName}
        onTargetProjectChange={setTargetProjectId}
        projects={[targetProject, ...props.projects.filter((project) => project.id !== targetProject.id)]}
      />
    </GtmDataProvider>
  );
}
