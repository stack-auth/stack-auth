"use client";

import { DesignAlert, DesignBadge, DesignButton } from "@/components/design-components";
import { cn } from "@/components/ui";
import { formatGrowthRelativeTime } from "@/lib/growth/growth-format";
import { GROWTH_REPORT_PRESENTATION_FORMAT, type GrowthReportPresentation } from "@/lib/growth/growth-types";
import {
  createGrowthAdminReportPresentation,
  publishGrowthAdminReportPresentation,
  unpublishGrowthAdminReportPresentation,
  type GrowthAdminReportDetail,
} from "@/lib/growth/reports/growth-reports-admin-api";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { CaretDownIcon, CaretUpIcon, FileArrowUpIcon, FloppyDiskIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { GrowthPresentationSandbox, type GrowthPresentationRuntimeError } from "../components/presentation-sandbox";

const EMPTY_PRESENTATION_SOURCE = `function Dashboard() {
  return <div className="p-6">Add your customer-facing presentation here.</div>;
}`;

type PreviewOutcome = "pending" | "ready" | "failed";

export function PresentationEditor(props: {
  app: object,
  projectId: string,
  report: GrowthAdminReportDetail,
  onReportChange: (report: GrowthAdminReportDetail) => void,
}) {
  const { report } = props;
  const [presentations, setPresentations] = useState(report.presentations);
  const [selectedPresentationId, setSelectedPresentationId] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState("");
  const [draftActionItemIds, setDraftActionItemIds] = useState<string[]>([]);
  const [pendingMutation, setPendingMutation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<GrowthPresentationRuntimeError | null>(null);
  const [previewState, setPreviewState] = useState<{ source: string, outcome: PreviewOutcome }>({ source: "", outcome: "pending" });
  const [droppedActionItemCount, setDroppedActionItemCount] = useState(0);
  const [nowMillis] = useState(() => Date.now());

  const resolveDraftActionItemIds = (actionItemIds: string[]) => {
    const availableActionItemIds = new Set(report.actionItems.map((action) => action.id));
    const resolvedActionItemIds = actionItemIds.filter((actionItemId) => availableActionItemIds.has(actionItemId));
    setDroppedActionItemCount(actionItemIds.length - resolvedActionItemIds.length);
    return resolvedActionItemIds;
  };

  useEffect(() => {
    const ordered = [...report.presentations].sort((a, b) => b.version - a.version);
    setPresentations(ordered);
    setDroppedActionItemCount(0);
    if (ordered.length === 0) {
      setSelectedPresentationId(null);
      setDraftSource(EMPTY_PRESENTATION_SOURCE);
      setDraftActionItemIds([]);
      setPreviewState({ source: EMPTY_PRESENTATION_SOURCE, outcome: "pending" });
    } else {
      const initial = ordered[0];
      setSelectedPresentationId(initial.id);
      setDraftSource(initial.tsxSource);
      setDraftActionItemIds(resolveDraftActionItemIds(initial.actionItemIds));
      setPreviewState({ source: initial.tsxSource, outcome: "pending" });
    }
    setRuntimeError(null);
    setError(null);
    // Keep the editor draft stable across authoritative save/publish snapshots; only switching
    // reports should reinitialize its selected version and source.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  const selectedPresentation = presentations.find((presentation) => presentation.id === selectedPresentationId) ?? null;
  const livePresentation = presentations.find((presentation) => presentation.publishedAtMillis != null) ?? null;
  const selectedActions = useMemo(
    () => draftActionItemIds
      .map((id) => report.actionItems.find((action) => action.id === id))
      .filter((action) => action != null),
    [draftActionItemIds, report.actionItems],
  );
  const draftChanged = selectedPresentation == null
    || selectedPresentation.tsxSource !== draftSource
    || selectedPresentation.actionItemIds.join("\u0000") !== draftActionItemIds.join("\u0000");
  const previewOutcome = previewState.source === draftSource ? previewState.outcome : "pending";

  const replacePresentations = useCallback((nextPresentations: GrowthReportPresentation[], publishedAtMillis: number | null, publishedByUserId: string | null) => {
    const ordered = [...nextPresentations].sort((a, b) => b.version - a.version);
    setPresentations(ordered);
    props.onReportChange({
      ...report,
      publishedAtMillis,
      publishedByUserId,
      presentations: ordered,
    });
  }, [props, report]);

  const selectPresentation = (presentation: GrowthReportPresentation) => {
    setSelectedPresentationId(presentation.id);
    setDraftSource(presentation.tsxSource);
    setDraftActionItemIds(resolveDraftActionItemIds(presentation.actionItemIds));
    setPreviewState({ source: presentation.tsxSource, outcome: "pending" });
    setRuntimeError(null);
    setError(null);
  };

  const updateDraftSource = (source: string) => {
    setDraftSource(source);
    setPreviewState({ source, outcome: "pending" });
    setRuntimeError(null);
  };

  const onSourceFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file == null) return;
    try {
      updateDraftSource(await file.text());
      setError(null);
    } catch (fileError) {
      captureError("growth-admin-presentation-file-read", fileError);
      setError(fileError instanceof Error ? fileError.message : String(fileError));
    }
  };

  const saveVersion = async () => {
    setPendingMutation(true);
    setError(null);
    try {
      const created = await createGrowthAdminReportPresentation(props.app, props.projectId, report.id, {
        format: GROWTH_REPORT_PRESENTATION_FORMAT,
        tsxSource: draftSource,
        actionItemIds: draftActionItemIds,
      });
      const nextPresentations = [created, ...presentations.filter((presentation) => presentation.id !== created.id)];
      setSelectedPresentationId(created.id);
      setPresentations(nextPresentations);
      setDroppedActionItemCount(0);
      props.onReportChange({ ...report, presentations: nextPresentations });
      if (previewState.source !== created.tsxSource) {
        setPreviewState({ source: created.tsxSource, outcome: "pending" });
        setRuntimeError(null);
      }
    } catch (saveError) {
      captureError("growth-admin-presentation-create", saveError);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setPendingMutation(false);
    }
  };

  const publishVersion = async () => {
    if (selectedPresentation == null) return;
    setPendingMutation(true);
    setError(null);
    try {
      const published = await publishGrowthAdminReportPresentation(props.app, props.projectId, report.id, selectedPresentation.id);
      const nextPresentations = presentations.map((presentation) => presentation.id === published.id
        ? published
        : { ...presentation, publishedAtMillis: null, publishedByUserId: null });
      replacePresentations(nextPresentations, published.publishedAtMillis, published.publishedByUserId);
    } catch (publishError) {
      captureError("growth-admin-presentation-publish", publishError);
      setError(publishError instanceof Error ? publishError.message : String(publishError));
    } finally {
      setPendingMutation(false);
    }
  };

  const unpublishVersion = async () => {
    if (livePresentation == null) return;
    setPendingMutation(true);
    setError(null);
    try {
      const unpublished = await unpublishGrowthAdminReportPresentation(props.app, props.projectId, report.id, livePresentation.id);
      const nextPresentations = presentations.map((presentation) => presentation.id === unpublished.id ? unpublished : presentation);
      replacePresentations(nextPresentations, null, null);
    } catch (unpublishError) {
      captureError("growth-admin-presentation-unpublish", unpublishError);
      setError(unpublishError instanceof Error ? unpublishError.message : String(unpublishError));
    } finally {
      setPendingMutation(false);
    }
  };

  const toggleAction = (actionId: string) => {
    setDraftActionItemIds((current) => current.includes(actionId)
      ? current.filter((id) => id !== actionId)
      : [...current, actionId]);
  };

  const moveAction = (actionId: string, direction: -1 | 1) => {
    const index = draftActionItemIds.indexOf(actionId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftActionItemIds.length) return;
    setDraftActionItemIds((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  };

  return (
    <section className="space-y-4 border-t border-foreground/[0.09] pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Customer presentation</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Paste or upload the TSX staff wants customers to read. Saving creates a version; publishing
            releases that version and its selected actions to the customer.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DesignBadge label={livePresentation == null ? "not released" : `live v${livePresentation.version}`} color={livePresentation == null ? "orange" : "green"} size="sm" />
          <DesignBadge label={GROWTH_REPORT_PRESENTATION_FORMAT} color="blue" size="sm" />
        </div>
      </div>

      {error != null && <DesignAlert variant="error">{error}</DesignAlert>}
      {runtimeError != null && (
        <DesignAlert variant="error">
          <p className="font-medium">Fix the preview before publishing</p>
          <p className="mt-1 text-sm">This presentation cannot be published while its preview is failing.</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{runtimeError.message}</p>
          {runtimeError.componentStack != null && <pre className="mt-2 max-h-32 overflow-auto text-xs">{runtimeError.componentStack}</pre>}
        </DesignAlert>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-sm font-medium" htmlFor={`growth-presentation-source-${report.id}`}>TSX source</label>
            <label className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-foreground/[0.12] px-3 py-1.5 text-xs font-medium",
              pendingMutation ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-foreground/[0.04]",
            )}>
              <FileArrowUpIcon className="size-4" />
              Upload file
              <input className="sr-only" type="file" accept=".tsx,.jsx,.ts,.js,text/plain" disabled={pendingMutation} onChange={(event) => runAsynchronously(onSourceFileChange(event))} />
            </label>
          </div>
          <textarea
            id={`growth-presentation-source-${report.id}`}
            value={draftSource}
            disabled={pendingMutation}
            onChange={(event) => updateDraftSource(event.target.value)}
            className="min-h-[24rem] w-full rounded-xl border border-foreground/[0.12] bg-background p-3 font-mono text-xs leading-5 outline-none transition-colors focus:border-foreground/30"
            spellCheck={false}
            aria-label="Customer presentation TSX source"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {selectedPresentation == null ? "New presentation version" : draftChanged ? "Unsaved draft changes" : `Editing saved version ${selectedPresentation.version}`}
            </span>
            <DesignButton
              size="sm"
              disabled={pendingMutation || draftSource.trim().length === 0}
              onClick={saveVersion}
            >
              <FloppyDiskIcon className="size-4" />
              Save new version
            </DesignButton>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Live preview</p>
            <span className="text-xs text-muted-foreground">Not visible until published</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-foreground/[0.09] bg-background">
            {draftSource.trim().length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Add source to preview the presentation.</p>
            ) : (
              <GrowthPresentationSandbox
                tsxSource={draftSource}
                onReady={() => {
                  setPreviewState((current) => current.source === draftSource ? { source: current.source, outcome: "ready" } : current);
                  setRuntimeError(null);
                }}
                onRuntimeError={(nextRuntimeError) => {
                  setPreviewState((current) => current.source === draftSource ? { source: current.source, outcome: "failed" } : current);
                  setRuntimeError(nextRuntimeError);
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
        <div className="space-y-3 rounded-xl border border-foreground/[0.09] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Versions</p>
              <p className="text-xs text-muted-foreground">Select any saved version to preview or publish it.</p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{presentations.length} saved</span>
          </div>
          {presentations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved versions yet.</p>
          ) : (
            <div className="space-y-2">
              {presentations.map((presentation) => (
                <button
                  key={presentation.id}
                  type="button"
                  disabled={pendingMutation}
                  onClick={() => selectPresentation(presentation)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors hover:transition-none disabled:cursor-not-allowed disabled:opacity-50",
                    selectedPresentationId === presentation.id ? "border-foreground/25 bg-foreground/[0.05]" : "border-foreground/[0.09] hover:bg-foreground/[0.03]",
                  )}
                >
                  <span className="flex-1 text-sm font-medium">Version {presentation.version}</span>
                  {presentation.publishedAtMillis != null && <DesignBadge label="live" color="green" size="sm" />}
                  <span className="text-xs text-muted-foreground">{formatGrowthRelativeTime(presentation.createdAtMillis, nowMillis)}</span>
                </button>
              ))}
            </div>
          )}
          {selectedPresentation != null && (
            <div className="flex flex-wrap items-center gap-2 border-t border-foreground/[0.09] pt-3">
              <DesignButton size="sm" disabled={pendingMutation || draftChanged || previewOutcome !== "ready"} onClick={publishVersion}>
                <RocketLaunchIcon className="size-4" />
                Publish version {selectedPresentation.version}
              </DesignButton>
              {livePresentation != null && (
                <DesignButton size="sm" variant="outline" disabled={pendingMutation} onClick={unpublishVersion}>
                  Unpublish
                </DesignButton>
              )}
            </div>
          )}
          <DesignAlert variant="info">
            {runtimeError != null
              ? "Publishing is disabled because the preview is failing. Fix the preview before publishing."
              : previewOutcome !== "ready"
                ? "Publishing is disabled until the preview renders successfully. Wait for the preview to finish rendering, then publish to release this report to the customer."
                : "Publishing releases this report to the customer. Unpublishing pulls it back immediately; the customer will not see the presentation or its actions."}
          </DesignAlert>
        </div>

        <div className="space-y-3 rounded-xl border border-foreground/[0.09] p-3">
          <div>
            <p className="text-sm font-medium">Customer actions</p>
            <p className="text-xs text-muted-foreground">Choose the actions customers may see, then order them with the controls below.</p>
          </div>
          {report.actionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">This report has no action items to curate.</p>
          ) : (
            <div className="space-y-2">
              {report.actionItems.map((action) => {
                const selectedIndex = draftActionItemIds.indexOf(action.id);
                return (
                  <label key={action.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-foreground/[0.09] p-3 hover:bg-foreground/[0.03]">
                    <input type="checkbox" checked={selectedIndex >= 0} disabled={pendingMutation} onChange={() => toggleAction(action.id)} className="mt-1 size-4 accent-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{action.title}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{action.description}</span>
                    </span>
                    {selectedIndex >= 0 && <span className="font-mono text-xs text-muted-foreground">#{selectedIndex + 1}</span>}
                  </label>
                );
              })}
            </div>
          )}
          {droppedActionItemCount > 0 && (
            <DesignAlert variant="warning">
              {droppedActionItemCount} previously curated {droppedActionItemCount === 1 ? "action was" : "actions were"} no longer in this report and {droppedActionItemCount === 1 ? "was" : "were"} dropped from this draft. The saved version remains unchanged until you save a new version.
            </DesignAlert>
          )}
          {selectedActions.length > 0 && (
            <div className="border-t border-foreground/[0.09] pt-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Customer order</p>
              <div className="space-y-2">
                {selectedActions.map((action, index) => (
                  <div key={action.id} className="flex items-center gap-2 rounded-lg bg-foreground/[0.03] px-3 py-2">
                    <span className="w-5 font-mono text-xs text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{action.title}</span>
                    <DesignButton size="sm" variant="ghost" disabled={pendingMutation || index === 0} onClick={() => moveAction(action.id, -1)} aria-label={`Move ${action.title} up`}>
                      <CaretUpIcon className="size-4" />
                    </DesignButton>
                    <DesignButton size="sm" variant="ghost" disabled={pendingMutation || index === selectedActions.length - 1} onClick={() => moveAction(action.id, 1)} aria-label={`Move ${action.title} down`}>
                      <CaretDownIcon className="size-4" />
                    </DesignButton>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
