"use client";

import { DesignAlert, DesignButton, DesignCard, DesignSelectorDropdown } from "@/components/design-components";
import { updateGrowthAdminAction, type GrowthAdminFunctionalActionFields } from "@/lib/growth/growth-api";
import { GROWTH_METRIC_IDS, type GrowthActionItem } from "@/lib/growth/growth-types";
import { captureError } from "@hexclave/shared/dist/utils/errors";
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

/**
 * The parts of an action that have no customer-facing representation: the machine payload the action
 * executes with, the metrics its outcome is judged by, and its workflow record. Everything a customer
 * can see is edited in place on the workspace itself; these fields live here because they are only
 * mutable while the action is still a proposal (the backend rejects them afterwards, since an active
 * action has already been executed against them).
 */
export function GrowthAdminActionInternalsCard(props: { app: object, projectId: string, actions: GrowthActionItem[], onSaved: () => Promise<void> }) {
  const proposed = props.actions.filter((action) => action.status === "proposed");
  const [requestedId, setRequestedId] = useState<string | null>(null);
  // Activating a proposal elsewhere on the page refreshes this list without it, so the stored choice is
  // reconciled against the current proposals rather than trusted — otherwise the card would claim there
  // are no proposals left while others are still waiting.
  const selected = proposed.find((action) => action.id === requestedId) ?? proposed.at(0) ?? null;
  const [payloadJson, setPayloadJson] = useState("null");
  const [watchedJson, setWatchedJson] = useState("[]");
  const [workflowDraftJson, setWorkflowDraftJson] = useState("null");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPayloadJson(selected?.payload == null ? "null" : JSON.stringify(selected.payload, null, 2));
    setWatchedJson(JSON.stringify(selected?.watchedMetrics ?? [], null, 2));
    setWorkflowDraftJson(selected == null ? "null" : workflowJson(selected));
  }, [selected]);

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
            try {
              const functionalFields: GrowthAdminFunctionalActionFields = {
                payload: z.unknown().parse(JSON.parse(payloadJson)),
                watchedMetrics: watchedMetricsSchema.parse(JSON.parse(watchedJson)),
                workflow: workflowSchema.parse(JSON.parse(workflowDraftJson)),
              };
              await updateGrowthAdminAction(props.app, props.projectId, selected, functionalFields);
              await props.onSaved();
            } catch (caught) {
              captureError("growth-admin-action-internals", caught);
              setError(caught instanceof Error ? caught.message : String(caught));
            }
          }}>Save internals</DesignButton>
        </div>
      )}
    </DesignCard>
  );
}
