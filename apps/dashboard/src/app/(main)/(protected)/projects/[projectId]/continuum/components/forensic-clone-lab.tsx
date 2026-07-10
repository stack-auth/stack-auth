"use client";

import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignDialog,
  DesignDialogClose,
} from "@/components/design-components";
import {
  CheckCircleIcon,
  ClockCountdownIcon,
  DatabaseIcon,
  FlaskIcon,
  LinkIcon,
  LockKeyIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { CLONE_PRESETS } from "../fixtures/databases";
import { FORENSIC_COPILOT_SCRIPT } from "../fixtures/copilot-script";
import { useDemoScript, type ScriptStep } from "../use-demo-scripts";

const constructionScript: ScriptStep[] = [
  { kind: "progress", id: "snapshot", label: "Snapshot production branch", status: "running" },
  { kind: "wait", ms: 220 },
  { kind: "progress", id: "snapshot", label: "Snapshot production branch", status: "done" },
  { kind: "progress", id: "sample", label: "Keep representative tenant data", status: "running" },
  { kind: "wait", ms: 220 },
  { kind: "progress", id: "sample", label: "Keep representative tenant data", status: "done" },
  { kind: "progress", id: "redact", label: "Replace sensitive values", status: "running" },
  { kind: "wait", ms: 260 },
  { kind: "progress", id: "redact", label: "Replace sensitive values", status: "done" },
  { kind: "progress", id: "verify", label: "Verify links between records", status: "running" },
  { kind: "wait", ms: 220 },
  { kind: "progress", id: "verify", label: "Verify links between records", status: "done" },
  { kind: "line", text: "Forensic clone ready", level: "success" },
];

const constructionStepIds = ["snapshot", "sample", "redact", "verify"] as const;

function getForensicPreset() {
  const preset = CLONE_PRESETS.find((candidate) => candidate.id === "clone-5gb");
  if (preset == null) throw new Error("The 5 GB forensic clone preset is required for Incident Command.");
  return preset;
}

function getApprovalRequest() {
  const turn = FORENSIC_COPILOT_SCRIPT.find((candidate) => candidate.approval != null);
  if (turn?.approval == null) throw new Error("The forensic copilot script must include an approval request.");
  return { turn, approval: turn.approval };
}

const forensicPreset = getForensicPreset();
const approvalRequest = getApprovalRequest();

export function ForensicCloneLab({
  open,
  onOpenChange,
  cloneReady,
  waitingOnApproval,
  approved,
  onApprove,
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  cloneReady: boolean,
  waitingOnApproval: boolean,
  approved: boolean,
  onApprove: () => void,
}) {
  const shouldReduceMotion = useReducedMotion();
  const { state, reset } = useDemoScript(constructionScript, cloneReady);

  useEffect(() => {
    if (!cloneReady) reset();
  }, [cloneReady, reset]);

  const visibleTurns = approved
    ? FORENSIC_COPILOT_SCRIPT
    : FORENSIC_COPILOT_SCRIPT.slice(0, FORENSIC_COPILOT_SCRIPT.indexOf(approvalRequest.turn) + 1);

  return (
    <DesignDialog
      open={open}
      onOpenChange={onOpenChange}
      size="4xl"
      icon={FlaskIcon}
      title="Forensic Clone Lab"
      description="A sanitized copy for reproducing the customer issue without touching production."
      footer={(
        <DesignDialogClose asChild>
          <DesignButton variant="secondary">Close lab</DesignButton>
        </DesignDialogClose>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <DesignCard
            title="Construction timeline"
            icon={DatabaseIcon}
            gradient="cyan"
            actions={<DesignBadge label={state.finished ? "Ready" : "Building"} color={state.finished ? "green" : "cyan"} size="sm" />}
          >
            <div className="space-y-2">
              {constructionStepIds.map((stepId) => {
                const progress = state.progress.get(stepId);
                const done = progress?.status === "done";
                return (
                  <div key={stepId} className="flex items-center gap-2 rounded-xl bg-foreground/[0.035] px-3 py-2">
                    <CheckCircleIcon
                      className={done ? "h-4 w-4 text-emerald-600 dark:text-emerald-400" : "h-4 w-4 text-muted-foreground"}
                      weight={done ? "fill" : "regular"}
                    />
                    <span className="text-xs text-foreground">{progress?.label ?? "Waiting…"}</span>
                  </div>
                );
              })}
            </div>
          </DesignCard>

          <motion.div
            initial={false}
            animate={{
              opacity: state.progress.get("redact")?.status === "done" ? 1 : 0.45,
              scale: state.progress.get("redact")?.status === "done" && !shouldReduceMotion ? [0.99, 1.01, 1] : 1,
            }}
          >
            <DesignCard
              title="Redaction report"
              subtitle={`${forensicPreset.redactionReport.length} sensitive fields transformed · record links preserved`}
              icon={LockKeyIcon}
              gradient="purple"
            >
              <div className="flex flex-wrap gap-2">
                {forensicPreset.redactionReport.map((item) => (
                  <DesignBadge key={item.field} label={`${item.field} · ${item.kind}`} color="purple" size="sm" />
                ))}
              </div>
            </DesignCard>
          </motion.div>

          <DesignAlert
            variant="info"
            title="Temporary clone URL"
            description={(
              <span className="flex flex-wrap items-center gap-2">
                <LinkIcon className="h-3.5 w-3.5" />
                <span className="font-mono">atlas-forensics-147.hexclave.app</span>
                <span className="flex items-center gap-1"><ClockCountdownIcon className="h-3.5 w-3.5" />Expires in 30 minutes</span>
              </span>
            )}
          />
        </div>

        <DesignCard
          title="Agent investigation"
          subtitle="The agent can inspect only this sanitized clone."
          icon={RobotIcon}
          gradient={approved ? "green" : "orange"}
          actions={<DesignBadge label={approved ? "Access approved" : "Approval required"} color={approved ? "green" : "orange"} size="sm" />}
        >
          <div className="space-y-2">
            {visibleTurns.map((turn) => (
              <div key={turn.id} className="rounded-xl bg-foreground/[0.035] px-3 py-2 ring-1 ring-foreground/[0.05]">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {turn.role === "agent" ? "Devin" : "System"}
                </div>
                <p className="text-xs leading-relaxed text-foreground">{turn.text}</p>
              </div>
            ))}

            {!approved && (
              <div className={waitingOnApproval ? "rounded-xl bg-amber-500/[0.08] p-3 ring-2 ring-amber-500/25" : "rounded-xl bg-foreground/[0.035] p-3"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{approvalRequest.approval.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{approvalRequest.approval.detail}</p>
                  </div>
                  <DesignBadge label={`${approvalRequest.approval.expiresInMinutes} min`} color="orange" size="sm" />
                </div>
                <DesignButton className="mt-3 w-full" onClick={onApprove} disabled={!waitingOnApproval}>
                  Approve Agent Access
                </DesignButton>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 pt-2">
              <div className="rounded-xl bg-foreground/[0.035] p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Repro</div>
                <div className={approved ? "mt-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400" : "mt-1 text-xs font-semibold text-red-600 dark:text-red-400"}>
                  {approved ? "Failed → Passed" : "Failed"}
                </div>
              </div>
              <div className="flex items-center justify-center rounded-xl bg-emerald-500/[0.07] p-3">
                <DesignBadge label="Compat green" color="green" size="sm" />
              </div>
              <div className="flex items-center justify-center rounded-xl bg-emerald-500/[0.07] p-3">
                <DesignBadge label="Regression green" color="green" size="sm" />
              </div>
            </div>

            {approved && (
              <DesignAlert
                variant="success"
                title="Fix verified"
                description="The issue now passes in the clone. Compatibility and regression checks are green."
              />
            )}
          </div>
        </DesignCard>
      </div>
    </DesignDialog>
  );
}
