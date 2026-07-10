"use client";

import { DesignButton, DesignPillToggle } from "@/components/design-components";
import { CheckCircleIcon, CopyIcon, DatabaseIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { CLONE_PRESETS, SCHEMA_TABLES } from "../fixtures/databases";
import { useDemoScript, type ScriptStep } from "../use-demo-scripts";
import { SensitiveKindChip } from "./schema-browser";
import { CxChip, CxPanel, cx } from "./ui-kit";

const CLONE_STEPS: ScriptStep[] = [
  { kind: "progress", id: "snapshot", label: "Snapshot", status: "running" },
  { kind: "wait", ms: 450 },
  { kind: "progress", id: "snapshot", label: "Snapshot", status: "done" },
  { kind: "progress", id: "sample", label: "Sample", status: "running" },
  { kind: "wait", ms: 550 },
  { kind: "progress", id: "sample", label: "Sample", status: "done" },
  { kind: "progress", id: "anonymize", label: "Anonymize", status: "running" },
  { kind: "wait", ms: 650 },
  { kind: "progress", id: "anonymize", label: "Anonymize", status: "done" },
  { kind: "progress", id: "verify", label: "Verify", status: "running" },
  { kind: "wait", ms: 500 },
  { kind: "progress", id: "verify", label: "Verify", status: "done" },
  { kind: "progress", id: "ready", label: "Ready", status: "done" },
];

const STEP_IDS = ["snapshot", "sample", "anonymize", "verify", "ready"] as const;

export function CloneWizard() {
  const [presetId, setPresetId] = useState(CLONE_PRESETS[1].id);
  const [started, setStarted] = useState(false);
  const [attachment, setAttachment] = useState<"pr" | "dev" | null>(null);
  const demo = useDemoScript(CLONE_STEPS);
  const preset = CLONE_PRESETS.find((item) => item.id === presetId) ?? CLONE_PRESETS[1];
  const sensitiveColumns = SCHEMA_TABLES.flatMap((table) =>
    table.columns
      .filter((column) => column.sensitive != null)
      .map((column) => ({ table: table.name, column })),
  );

  const start = () => {
    setStarted(true);
    setAttachment(null);
    demo.start();
  };

  return (
    <CxPanel
      title="Make a safe copy"
      meta={<CxChip>anonymized</CxChip>}
      bodyClassName="space-y-4 p-3"
    >
      <p className={cx.muted}>A safe copy of your real data — emails and names replaced with fakes.</p>
      <div>
        <p className={cx.label}>Copy size</p>
        <div className="mt-2">
          <DesignPillToggle
            options={CLONE_PRESETS.map((item) => ({ id: item.id, label: item.targetSizeLabel === "Full (2 TB)" ? "Full" : item.targetSizeLabel }))}
            selected={presetId}
            onSelect={setPresetId}
            size="sm"
          />
        </div>
        <p className="mt-2 text-sm font-medium tabular-nums">
          {preset.targetSizeLabel} — {preset.orgsPreserved.toLocaleString()} orgs including {preset.enterpriseOrgs} enterprise, with whole organizations kept together.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {preset.coverageNotes.map((note) => <CxChip key={note}>{note}</CxChip>)}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className={`${cx.panelInset} p-3`}>
          <p className={cx.label}>Schema preview</p>
          <div className="mt-2 space-y-1.5">
            {sensitiveColumns.slice(0, 6).map(({ table, column }) => (
              <div key={`${table}.${column.name}`} className="flex items-center gap-2 rounded-md bg-amber-500/[0.06] px-2.5 py-1.5 text-xs">
                <span className={`min-w-0 flex-1 truncate ${cx.mono}`}>{table}.{column.name}</span>
                {column.sensitive != null && <SensitiveKindChip kind={column.sensitive.kind} />}
              </div>
            ))}
          </div>
        </div>
        <div className={`${cx.panelInset} p-3`}>
          <p className={cx.label}>Redaction report</p>
          <div className="mt-2 space-y-2">
            {preset.redactionReport.map((entry) => (
              <div key={entry.field} className="text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-3.5 text-emerald-600" />
                  <span className={cx.mono}>{entry.field}</span>
                </div>
                <p className={`ml-5 mt-0.5 truncate ${cx.mono} text-muted-foreground`}>example: {entry.example}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {started && (
        <div className={`${cx.panelInset} p-3`}>
          <div className="grid grid-cols-5 gap-2">
            {STEP_IDS.map((id) => {
              const progress = demo.state.progress.get(id);
              return (
                <div key={id} className="text-center">
                  <div className={`mx-auto flex size-7 items-center justify-center rounded-full text-xs font-semibold ${
                    progress?.status === "done"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : progress?.status === "running"
                        ? "bg-[#7c6cff]/15 text-[#5b4fd6] dark:text-[#b4acff]"
                        : "bg-foreground/[0.05] text-muted-foreground"
                  }`}>
                    {progress?.status === "done" ? <CheckCircleIcon className="size-4" /> : STEP_IDS.indexOf(id) + 1}
                  </div>
                  <p className="mt-1 text-[10px] capitalize text-muted-foreground">{id}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {demo.state.finished ? (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.07] px-3 py-2.5 text-xs leading-5 text-emerald-950 dark:text-emerald-100">
            Safe copy ready — sensitive values were replaced and the sample passed verification.
          </div>
          <div className={`${cx.panelInset} p-3`}>
            <p className={cx.label}>Connection string</p>
            <code className={`mt-1 block overflow-x-auto ${cx.mono}`}>postgres://safe_copy:••••@clone-5gb.db.hexclave.dev/acme</code>
          </div>
          <div className="flex flex-wrap gap-2">
            <DesignButton size="sm" onClick={() => setAttachment("pr")}><CopyIcon className="mr-1.5 size-4" />Attach to PR</DesignButton>
            <DesignButton size="sm" variant="secondary" onClick={() => setAttachment("dev")}><DatabaseIcon className="mr-1.5 size-4" />Attach to dev environment</DesignButton>
          </div>
          {attachment != null && <p className="text-xs text-emerald-700 dark:text-emerald-300">Attached to {attachment === "pr" ? "pricing PR #184" : "Maya’s development environment"} ✓</p>}
        </div>
      ) : (
        <DesignButton onClick={start} loading={started && demo.state.progress.size > 0} loadingStyle="disabled">
          <ShieldCheckIcon className="mr-2 size-4" />
          Make Me a Safe Copy
        </DesignButton>
      )}
    </CxPanel>
  );
}
