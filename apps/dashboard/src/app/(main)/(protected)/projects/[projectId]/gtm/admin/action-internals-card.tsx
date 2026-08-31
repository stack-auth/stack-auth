"use client";

import { DesignAlert, DesignButton, DesignCard, DesignSelectorDropdown } from "@/components/design-components";
import { updateGrowthAdminAction, type GrowthAdminFunctionalActionFields } from "@/lib/growth/growth-api";
import { GROWTH_METRIC_IDS, type GrowthActionItem } from "@/lib/growth/growth-types";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { BracketsCurlyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { z } from "zod";

const watchedMetricsSchema = z.array(z.object({ metricId: z.enum(GROWTH_METRIC_IDS), windowDays: z.number().int().min(1).max(90) })).max(10);
const workflowSchema = z.object({ workflowId: z.string().min(1).max(64), source: z.string().min(1), explanation: z.string().min(1).max(5000), rollbackNote: z.string().min(1).max(5000) }).nullable();

function workflowJson(action: GrowthActionItem): string {
  if (action.workflow == null) return "null";
  const { workflowId, source, explanation, rollbackNote } = action.workflow;
  return JSON.stringify({ workflowId, source, explanation, rollbackNote }, null, 2);
}

function JsonField(props: { label: string, value: string, onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-medium">
      {props.label}
      <textarea className="mt-1 min-h-40 w-full rounded-xl border bg-background p-3 font-mono text-xs" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  );
}

export function GrowthAdminActionInternalsCard(props: { app: object, projectId: string, actions: GrowthActionItem[], onSaved: () => Promise<void> }) {
  const proposed = props.actions.filter((action) => action.status === "proposed");
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const selected = proposed.find((action) => action.id === requestedId) ?? proposed.at(0) ?? null;
  const [payloadJson, setPayloadJson] = useState("null");
  const [watchedJson, setWatchedJson] = useState("[]");
  const [workflowDraftJson, setWorkflowDraftJson] = useState("null");
  const [error, setError] = useState<string | null>(null);
  const [draftsFor, setDraftsFor] = useState<string | null>(null);

  useEffect(() => {
    const selectedId = selected?.id ?? null;
    if (selectedId === draftsFor) return;
    setPayloadJson(selected?.payload == null ? "null" : JSON.stringify(selected.payload, null, 2));
    setWatchedJson(JSON.stringify(selected?.watchedMetrics ?? [], null, 2));
    setWorkflowDraftJson(selected == null ? "null" : workflowJson(selected));
    setDraftsFor(selectedId);
  }, [draftsFor, selected]);

  return (
    <DesignCard title="Proposed action internals" subtitle="Payload, watched metrics and workflow — editable until the proposal is activated" icon={BracketsCurlyIcon} gradient="cyan">
      {error != null && <DesignAlert variant="error">{error}</DesignAlert>}
      {selected == null ? <p className="text-sm text-muted-foreground">No proposed actions.</p> : (
        <div className="space-y-3">
          <DesignSelectorDropdown value={selected.id} onValueChange={setRequestedId} options={proposed.map((action) => ({ value: action.id, label: action.title }))} />
          <div className="grid gap-3 sm:grid-cols-3">
            <JsonField label="Payload JSON" value={payloadJson} onChange={setPayloadJson} />
            <JsonField label="Watched metrics JSON" value={watchedJson} onChange={setWatchedJson} />
            <JsonField label="Workflow JSON" value={workflowDraftJson} onChange={setWorkflowDraftJson} />
          </div>
          {selected.category == null && (
            <p className="text-xs text-muted-foreground">Give this action a stage on the workspace above first — the Growth API stores actions per stage and rejects a write without one.</p>
          )}
          <DesignButton disabled={selected.category == null} onClick={async () => {
            setError(null);
            const result = await Result.fromThrowingAsync(async () => {
              const functionalFields: GrowthAdminFunctionalActionFields = {
                payload: z.unknown().parse(JSON.parse(payloadJson)),
                watchedMetrics: watchedMetricsSchema.parse(JSON.parse(watchedJson)),
                workflow: workflowSchema.parse(JSON.parse(workflowDraftJson)),
              };
              await updateGrowthAdminAction(props.app, props.projectId, selected, functionalFields);
              await props.onSaved();
            });
            if (result.status === "error") {
              captureError("growth-admin-action-internals", result.error);
              setError(result.error instanceof Error ? result.error.message : String(result.error));
            }
          }}>Save internals</DesignButton>
        </div>
      )}
    </DesignCard>
  );
}
