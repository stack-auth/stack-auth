"use client";

import type { RolloutStage, RolloutStageStatus } from "../fixtures/types";
import { CxChip, CxPanel, StatusDot, cellStateToCxStatus, cx, type CxStatus } from "./ui-kit";

export type RolloutStagesProps = {
  stages: RolloutStage[],
  stageStatuses?: ReadonlyMap<string, RolloutStageStatus>,
};

function statusToCx(status: RolloutStageStatus): CxStatus {
  switch (status) {
    case "complete":
    case "healthy": {
      return "ok";
    }
    case "running": {
      return "info";
    }
    case "paused": {
      return "warn";
    }
    case "skipped":
    case "pending": {
      return "idle";
    }
    default: {
      const exhaustive: never = status;
      return cellStateToCxStatus(exhaustive);
    }
  }
}

function formatArr(arrUsd: number): string {
  if (arrUsd === 0) return "$0";
  if (arrUsd >= 1_000_000) return `$${(arrUsd / 1_000_000).toFixed(1)}M`;
  if (arrUsd >= 1_000) return `$${Math.round(arrUsd / 1_000)}k`;
  return `$${arrUsd}`;
}

export function RolloutStages({ stages, stageStatuses = new Map() }: RolloutStagesProps) {
  const resolvedStages = stages.map((stage) => {
    const status = stageStatuses.get(stage.id) ?? stage.status;
    const healthGate = status === "complete" || status === "healthy"
      ? "passing"
      : stage.healthGate;
    return { ...stage, status, healthGate };
  });
  const currentStageIndex = resolvedStages.findIndex((stage) => (
    stage.status === "running"
    || stage.status === "paused"
    || stage.status === "pending"
  ));

  return (
    <CxPanel
      title="Rollout"
      meta={<span className="text-[11px] text-muted-foreground">Smallest customers first</span>}
      bodyClassName="p-0"
    >
      <ol className="divide-y divide-black/[0.06] dark:divide-white/[0.06]">
        {resolvedStages.map((stage, index) => {
          const isCurrent = index === currentStageIndex;
          return (
            <li
              key={stage.id}
              className={[
                "flex items-start gap-3 px-4 py-3",
                isCurrent ? "bg-[#7c6cff]/[0.06]" : "",
              ].join(" ")}
            >
              <div className="mt-1.5 flex flex-col items-center gap-1">
                <StatusDot status={statusToCx(stage.status)} />
                {index < resolvedStages.length - 1 && (
                  <span className="h-8 w-px bg-black/[0.08] dark:bg-white/[0.08]" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-medium tracking-tight">
                      {index + 1}. {stage.label}
                      {isCurrent && <span className="ml-2 text-[10px] font-medium text-[#7c6cff]">current</span>}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{stage.segment}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CxChip>{stage.status.replace("_", " ")}</CxChip>
                    <CxChip tone={stage.healthGate === "passing" ? "ok" : stage.healthGate === "failing" ? "bad" : "neutral"}>
                      {stage.healthGate}
                    </CxChip>
                  </div>
                </div>
                <p className={cnMono(stage)}>
                  {stage.users.toLocaleString()} users · {stage.orgs.toLocaleString()} orgs · {formatArr(stage.arrUsd)} ARR
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </CxPanel>
  );
}

function cnMono(_stage: RolloutStage): string {
  return `mt-2 ${cx.mono} text-muted-foreground`;
}
