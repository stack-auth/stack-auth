"use client";

import { DesignAlert, DesignBadge, DesignButton, DesignCategoryTabs, DesignDialog, DesignInput } from "@/components/design-components";
import type { AdminWorkflowRun, AdminWorkflowRunDetails, AdminWorkflowUpgradeResult } from "@hexclave/next";
import { fromNow } from "@hexclave/shared/dist/utils/dates";
import { ArrowLeftIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useAdminApp } from "../use-admin-app";
import { getNewWorkflowSource } from "./example-source";
import { getRunStateBadgeColor, getRunStateLabel } from "./run-states";
import {
  EditableCodePanel,
  useAsyncLoad,
  WorkflowKpiRow,
  WorkflowRunsGrid,
  WorkflowsTable,
  WorkflowTitleRow,
} from "./shared";

// The Workflows page: an infinite-scroll table of workflows (with a
// new-workflow dialog), and a drill-in detail with the workflow's KPIs and
// two tabs — the runs grid (with a per-run step timeline dialog) and the
// always-editable code panel (version selector defaults to latest; saving
// mints and deploys the next version).

export type WorkflowDetailProps = {
  selectedWorkflowId: string | null,
  onSelect: (workflowId: string) => void,
  onClose: () => void,
};

export function WorkflowDetail({ selectedWorkflowId, onSelect, onClose }: WorkflowDetailProps) {
  if (selectedWorkflowId == null) {
    return <WorkflowsIndex onOpen={onSelect} />;
  }
  return <WorkflowDetailInner workflowId={selectedWorkflowId} onClose={onClose} />;
}

function WorkflowsIndex({ onOpen }: { onOpen: (workflowId: string) => void }) {
  const adminApp = useAdminApp();
  const workflows = adminApp.useWorkflows();
  const [createOpen, setCreateOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <DesignButton size="sm" onClick={() => {
          setNewId("");
          setCreateError(null);
          setCreateOpen(true);
        }}>
          <PlusIcon className="mr-1 h-3.5 w-3.5" />New workflow
        </DesignButton>
      </div>

      {workflows.length === 0 ? (
        <DesignAlert
          variant="default"
          title="No workflows yet"
          description="Create your first workflow to react to platform events (user.created, team.deleted, ...), custom events, or schedules with durable multi-step automations."
        />
      ) : (
        <WorkflowsTable workflows={workflows} onOpen={onOpen} />
      )}

      <DesignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        size="md"
        title="New workflow"
        description="The id is the workflow's stable business identity across versions (lowercase letters, digits, dashes)."
        footer={
          <div className="flex justify-end gap-2">
            <DesignButton variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</DesignButton>
            <DesignButton
              disabled={newId.trim().length === 0}
              onClick={async () => {
                setCreateError(null);
                const workflowId = newId.trim();
                try {
                  await adminApp.createWorkflow({ id: workflowId, source: getNewWorkflowSource(workflowId) });
                  setCreateOpen(false);
                  onOpen(workflowId);
                } catch (error) {
                  setCreateError(error instanceof Error ? error.message : String(error));
                }
              }}
            >
              Create
            </DesignButton>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <DesignInput
            value={newId}
            onChange={(event) => setNewId(event.target.value)}
            placeholder="welcome-drip"
            autoFocus
          />
          {createError != null && (
            <DesignAlert variant="error" title="Could not create workflow" description={createError} />
          )}
        </div>
      </DesignDialog>
    </div>
  );
}

type DetailTab = "runs" | "code";

function WorkflowDetailInner({ workflowId, onClose }: { workflowId: string, onClose: () => void }) {
  const adminApp = useAdminApp();
  const workflows = adminApp.useWorkflows();
  const workflow = workflows.find((w) => w.id === workflowId);
  const versionsLoad = useAsyncLoad(async () => await adminApp.listWorkflowVersions(workflowId), [workflowId]);
  const [tab, setTab] = useState<DetailTab>("runs");
  const [runsReloadKey, setRunsReloadKey] = useState(0);
  const [openRun, setOpenRun] = useState<AdminWorkflowRun | null>(null);
  const [upgradeResult, setUpgradeResult] = useState<AdminWorkflowUpgradeResult | null>(null);

  if (workflow == null) {
    // Freshly deleted project data or a stale link; fail soft with a way out.
    return (
      <div className="flex flex-col gap-4">
        <div>
          <DesignButton variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />All workflows
          </DesignButton>
        </div>
        <DesignAlert variant="error" title="Workflow not found" description={`No workflow with id "${workflowId}" exists in this project.`} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <DesignButton variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />All workflows
        </DesignButton>
      </div>

      <WorkflowTitleRow workflow={workflow} />
      <WorkflowKpiRow workflow={workflow} />

      <DesignCategoryTabs
        categories={[
          { id: "runs", label: "Runs", count: workflow.stats.activeRuns + workflow.stats.sleepingRuns },
          { id: "code", label: "Code", count: versionsLoad.data?.length ?? 0 },
        ]}
        selectedCategory={tab}
        onSelect={(id) => {
          if (id !== "runs" && id !== "code") {
            throw new Error(`Unknown workflow detail tab "${id}"`);
          }
          setTab(id);
        }}
        gradient="blue"
        size="sm"
      />

      {tab === "runs" && (
        <WorkflowRunsGrid
          workflowId={workflowId}
          latestVersion={workflow.latestVersion}
          reloadKey={runsReloadKey}
          onOpenRun={setOpenRun}
        />
      )}
      {tab === "code" && (
        versionsLoad.error != null ? (
          <DesignAlert variant="error" title="Failed to load versions" description={versionsLoad.error.message} />
        ) : versionsLoad.loading || versionsLoad.data == null ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading versions…</div>
        ) : (
          <EditableCodePanel
            workflowId={workflowId}
            versions={versionsLoad.data}
            onSynced={() => versionsLoad.reload()}
            onUpgraded={(result) => {
              setUpgradeResult(result);
              versionsLoad.reload();
              setRunsReloadKey((key) => key + 1);
            }}
          />
        )
      )}

      {openRun != null && (
        <RunDetailsDialog
          run={openRun}
          latestVersion={workflow.latestVersion}
          onClose={() => setOpenRun(null)}
          onChanged={() => setRunsReloadKey((key) => key + 1)}
        />
      )}

      <DesignDialog
        open={upgradeResult != null}
        onOpenChange={(open) => {
          if (!open) setUpgradeResult(null);
        }}
        size="lg"
        title="Upgrade result"
      >
        {upgradeResult != null && (
          <div className="flex flex-col gap-3">
            <DesignAlert
              variant={upgradeResult.skipped.length === 0 ? "success" : "default"}
              title={`${upgradeResult.upgradedCount.toLocaleString()} run(s) upgraded, ${upgradeResult.skipped.length.toLocaleString()} skipped`}
              description="Upgraded runs resume on the target version at their next step boundary. Skipped runs keep executing their pinned version — leave them to drain, cancel them, or retry the upgrade later."
            />
            {upgradeResult.skipped.map((skip) => (
              <div key={skip.runId} className="rounded-lg border border-border/60 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{skip.runKey ?? skip.runId}</span>
                  <DesignBadge label={`v${skip.fromVersion} (pinned)`} color="orange" size="sm" />
                  <span className="font-mono text-muted-foreground">{skip.diagnostic.reason}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{skip.diagnostic.details}</p>
              </div>
            ))}
          </div>
        )}
      </DesignDialog>
    </div>
  );
}

// ─── Run details (step timeline + memoized results + attempts) ─────────────

function RunDetailsDialog({ run, latestVersion, onClose, onChanged }: {
  run: AdminWorkflowRun,
  latestVersion: number,
  onClose: () => void,
  onChanged: () => void,
}) {
  const adminApp = useAdminApp();
  const detailsLoad = useAsyncLoad(async () => await adminApp.getWorkflowRun(run.id), [run.id]);
  const details = detailsLoad.data;
  const isActive = ["queued", "running", "sleeping"].includes(run.state);

  return (
    <DesignDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="xl"
      title={run.runKey ?? `${run.id.slice(0, 8)} · keyless`}
      description={`${run.workflowId} · started ${fromNow(new Date(run.createdAtMillis))} · triggered by ${run.triggerType}`}
      headerContent={
        <div className="flex flex-wrap items-center gap-2">
          <DesignBadge label={getRunStateLabel(run.state)} color={getRunStateBadgeColor(run.state)} size="sm" />
          <DesignBadge label={`v${run.version}${run.version === latestVersion ? "" : " (pinned)"}`} color="blue" size="sm" />
          {run.state === "failed" && (
            <DesignButton
              size="sm"
              variant="outline"
              onClick={async () => {
                await adminApp.retryWorkflowRun(run.id);
                onChanged();
                onClose();
              }}
            >
              Retry from failed step
            </DesignButton>
          )}
          {isActive && (
            <DesignButton
              size="sm"
              variant="destructive"
              onClick={async () => {
                await adminApp.cancelWorkflowRuns(run.workflowId, { runId: run.id });
                onChanged();
                onClose();
              }}
            >
              Cancel run
            </DesignButton>
          )}
        </div>
      }
    >
      {detailsLoad.error != null ? (
        <DesignAlert variant="error" title="Failed to load run" description={detailsLoad.error.message} />
      ) : details == null ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading run…</div>
      ) : (
        <RunDetailsBody details={details} />
      )}
    </DesignDialog>
  );
}

function RunDetailsBody({ details }: { details: AdminWorkflowRunDetails }) {
  return (
    <div className="flex flex-col gap-4">
      {details.errorSummary != null && (
        <DesignAlert
          variant="error"
          title={details.failureKind === "platform" ? "Platform error" : "Run failed"}
          description={details.errorSummary}
        />
      )}
      {details.lastUpgradeDivergence != null && (
        <DesignAlert
          variant="default"
          title={`Last upgrade attempt skipped this run (${details.lastUpgradeDivergence.reason})`}
          description={details.lastUpgradeDivergence.details}
        />
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Steps ({details.steps.length} recorded)</h3>
        {details.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {details.steps.map((step) => (
              <div key={step.stepKey} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-medium">{step.stepKey}</span>
                  <DesignBadge label={step.kind === "sleep" ? "sleep" : "step"} color={step.kind === "sleep" ? "purple" : "blue"} size="sm" />
                  <span className="text-muted-foreground">
                    v{step.executedAtVersion} · {step.attempts} attempt{step.attempts === 1 ? "" : "s"}
                    {step.elapsedMs != null ? ` · ${step.elapsedMs}ms` : ""} · {fromNow(new Date(step.createdAtMillis))}
                  </span>
                </div>
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-foreground/[0.03] p-2 font-mono text-[11px] text-foreground/80">
                  {JSON.stringify(step.result, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {details.stepAttempts.some((attempt) => attempt.outcome === "failed" || attempt.logs != null) && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attempts</h3>
          <div className="flex flex-col gap-2">
            {details.stepAttempts.map((attempt) => (
              <div key={`${attempt.stepKey}#${attempt.attempt}`} className="rounded-lg border border-border/60 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{attempt.stepKey} · attempt {attempt.attempt}</span>
                  <DesignBadge
                    label={attempt.outcome === "succeeded" ? "succeeded" : attempt.failureKind === "platform" ? "platform error" : "failed"}
                    color={attempt.outcome === "succeeded" ? "green" : "red"}
                    size="sm"
                  />
                  <span className="text-muted-foreground">{fromNow(new Date(attempt.startedAtMillis))}</span>
                </div>
                {attempt.error != null && (
                  <p className="mt-1 font-mono text-red-600 dark:text-red-400">{attempt.error.name}: {attempt.error.message}</p>
                )}
                {attempt.logs != null && (
                  <pre className="mt-2 max-h-32 overflow-auto rounded bg-foreground/[0.03] p-2 font-mono text-[11px] text-foreground/70">{attempt.logs}</pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Trigger payload</h3>
        <pre className="max-h-48 overflow-auto rounded bg-foreground/[0.03] p-2 font-mono text-[11px] text-foreground/80">
          {JSON.stringify(details.triggerPayload, null, 2)}
        </pre>
      </div>
    </div>
  );
}
