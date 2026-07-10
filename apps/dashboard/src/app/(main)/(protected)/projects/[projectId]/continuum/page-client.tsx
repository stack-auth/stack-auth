"use client";

import { DesignButton } from "@/components/design-components";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DatabaseIcon, PlayIcon, RocketLaunchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { ContinuumMap } from "./components/continuum-map";
import { DatabaseWorkspace } from "./components/database-workspace";
import { IncidentScrubber } from "./components/incident-scrubber";
import { NodeInspector } from "./components/node-inspector";
import { ProtectChecklist } from "./components/protect-checklist";
import { ReleaseCockpit } from "./components/release-cockpit";
import { ClosingBriefing } from "./components/closing-briefing";
import { ForensicCloneLab } from "./components/forensic-clone-lab";
import { CxChip } from "./components/ui-kit";
import {
  patchContinuumState,
  resetContinuumState,
  setCellState,
  setIncidentBanner,
} from "./continuum-store";
import { CANVAS_BRANCHES, MAP_NODES } from "./fixtures/topology";
import { CELLS, OVERVIEW_METRICS } from "./fixtures/tenants";
import { ACTIVE_RELEASE_ID, releaseById } from "./fixtures/releases";
import type { CellState, ContinuumMapNode } from "./fixtures/types";
import { useContinuumStore, useIncidentPlayback } from "./use-incident-playback";

type WorkspaceSheet = "deployments" | "incident" | "database" | null;

function formatCurrency(value: number): string {
  if (value === 0) return "$0";
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${value}`;
}

function mapCellStateToNodeHealth(state: CellState): string {
  switch (state) {
    case "degraded": {
      return "degraded";
    }
    case "protected":
    case "isolating":
    case "failing_over":
    case "recovering": {
      return "protected";
    }
    case "pinned": {
      return "pinned";
    }
    case "healthy":
    case "deploying": {
      return "healthy";
    }
    default: {
      const exhaustiveState: never = state;
      return exhaustiveState;
    }
  }
}

export default function PageClient() {
  const continuumState = useContinuumStore();
  const playback = useIncidentPlayback();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string>(CANVAS_BRANCHES[0].id);
  const [sheet, setSheet] = useState<WorkspaceSheet>(null);
  const [cloneLabOpen, setCloneLabOpen] = useState(false);
  const [agentAccessApproved, setAgentAccessApproved] = useState(false);

  const healthyCells = CELLS.filter((cell) => {
    const state = continuumState.cellStates.get(cell.id) ?? cell.state;
    return state === "healthy" || state === "pinned" || state === "protected";
  }).length;

  const nodeHealthOverrides = useMemo(() => {
    const fromStore = Array.from(continuumState.cellStates, ([cellId, state]) => [
      `n-${cellId}`,
      mapCellStateToNodeHealth(state),
    ] as const);

    // Incident stage overrides win while the incident sheet is open / active
    const fromIncident = playback.activeStage.overrides.cellStates;
    const incidentEntries: [string, string][] = [];
    if (fromIncident != null) {
      for (const [cellId, cellState] of Object.entries(fromIncident)) {
        if (cellState == null) continue;
        incidentEntries.push([`n-${cellId}`, mapCellStateToNodeHealth(cellState)]);
      }
    }
    return new Map([...fromStore, ...incidentEntries]);
  }, [continuumState.cellStates, playback.activeStage]);

  const edgeHealthOverrides = useMemo(() => {
    const edgeOverrides = playback.activeStage.overrides.edgeHealth;
    if (edgeOverrides == null) return undefined;
    return new Map(
      Object.entries(edgeOverrides).flatMap(([edgeId, health]) =>
        health == null ? [] : [[edgeId, health] as const],
      ),
    );
  }, [playback.activeStage]);

  const selectedNode: ContinuumMapNode | null = useMemo(() => {
    if (selectedNodeId == null) return null;
    return MAP_NODES.find((node) => node.id === selectedNodeId) ?? null;
  }, [selectedNodeId]);

  const cellStateOverrides = useMemo(() => {
    return new Map(Array.from(continuumState.cellStates, ([id, state]) => [id, state]));
  }, [continuumState.cellStates]);

  const release = {
    ...releaseById(ACTIVE_RELEASE_ID),
    status: continuumState.releaseStatus,
  };

  const {
    story,
    elapsedMs,
    isPlaying,
    activeStage,
    waitingOnGate,
    clearedGates,
    formatTime,
    setElapsedMs,
    setIsPlaying,
    clearGate,
  } = playback;

  const lastStage = story.stages.at(-1);
  if (lastStage == null) throw new Error("Incident story requires stages.");
  const protectionActive = activeStage.act >= 3 && clearedGates.has("act2-break");
  const showClosingBriefing = elapsedMs >= lastStage.offsetMs;

  const handleGateAction = () => {
    switch (activeStage.id) {
      case "act1-ready": {
        setIncidentBanner("v1.0.47 is rolling out to internal and free organizations first.");
        setCellState("cell-internal", "deploying");
        setCellState("cell-free-1", "deploying");
        setCellState("cell-free-2", "deploying");
        patchContinuumState((previous) => {
          const stageStatuses = new Map(previous.stageStatuses);
          stageStatuses.set("stage-1", "healthy");
          stageStatuses.set("stage-2", "running");
          return { ...previous, releaseStatus: "rolling_out", stageStatuses };
        });
        clearGate("act1-ready");
        return;
      }
      case "act2-break": {
        setCellState("cell-atlas", "pinned");
        setCellState("cell-northstar", "protected");
        setCellState("cell-lumen", "protected");
        setIncidentBanner("3 of your biggest customers are protected — $184,000 ARR is no longer at risk.");
        patchContinuumState((previous) => ({
          ...previous,
          releaseStatus: "paused",
          pinnedVersions: new Map([
            ...previous.pinnedVersions,
            ["cell-atlas", "v1.0.46"],
            ["cell-northstar", "v1.0.46"],
            ["cell-lumen", "v1.0.46"],
          ]),
        }));
        clearGate("act2-break");
        return;
      }
      case "act3-protect": {
        patchContinuumState({ forensicCloneReady: true });
        setCloneLabOpen(true);
        clearGate("act3-protect");
        return;
      }
      case "act4-clone": {
        setCloneLabOpen(true);
        return;
      }
      case "act4-fix": {
        setCellState("cell-atlas", "healthy");
        setCellState("cell-northstar", "healthy");
        setCellState("cell-lumen", "healthy");
        setIncidentBanner("All customers healthy on v1.0.47. Deferred cleanup released.");
        patchContinuumState({ releaseStatus: "complete", deferredReleased: true });
        clearGate("act4-fix");
        return;
      }
      default: {
        throw new Error(`No gate action for "${activeStage.id}".`);
      }
    }
  };

  return (
    <AppEnabledGuard appId="continuum">
      <PageLayout fillWidth noPadding containedHeight>
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Railway-style top bar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.08] bg-background/80 px-4 py-2.5 backdrop-blur-md dark:border-white/[0.08]">
            <div className="flex min-w-0 items-center gap-3">
              <div>
                <p className="text-[13px] font-semibold tracking-tight">Continuum</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatCurrency(OVERVIEW_METRICS.revenueExposedUsd)} exposed · {healthyCells}/{OVERVIEW_METRICS.cellsTotal} healthy · {OVERVIEW_METRICS.recoveryFreshnessSeconds}s recovery
                </p>
              </div>
              {continuumState.incidentBanner != null && (
                <CxChip tone="warn">Incident active</CxChip>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DesignButton
                size="sm"
                variant={sheet === "deployments" ? "default" : "outline"}
                onClick={() => setSheet(sheet === "deployments" ? null : "deployments")}
              >
                <RocketLaunchIcon className="mr-1.5 size-3.5" />
                Deployments
              </DesignButton>
              <DesignButton
                size="sm"
                variant={sheet === "database" ? "default" : "outline"}
                onClick={() => setSheet(sheet === "database" ? null : "database")}
              >
                <DatabaseIcon className="mr-1.5 size-3.5" />
                Database
              </DesignButton>
              <DesignButton
                size="sm"
                variant={sheet === "incident" ? "default" : "outline"}
                onClick={() => setSheet(sheet === "incident" ? null : "incident")}
              >
                <WarningCircleIcon className="mr-1.5 size-3.5" />
                Incident
              </DesignButton>
            </div>
          </div>

          {continuumState.incidentBanner != null && (
            <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/[0.08] px-4 py-2 text-[12px] text-amber-950 dark:text-amber-100">
              {continuumState.incidentBanner}
            </div>
          )}

          <div className="min-h-0 flex-1 p-3">
            <ContinuumMap
              nodeHealthOverrides={nodeHealthOverrides}
              edgeHealthOverrides={edgeHealthOverrides}
              selectedNodeId={selectedNodeId}
              onSelectNode={(id) => {
                const node = MAP_NODES.find((candidate) => candidate.id === id);
                // Database nodes get the full workspace sheet (replication, branches,
                // compat, safe copies) instead of the compact inspector.
                if (node?.kind === "database") {
                  setSelectedNodeId(null);
                  setSheet("database");
                  return;
                }
                setSelectedNodeId(id);
                setSheet(null);
              }}
              branchId={branchId}
              onBranchChange={setBranchId}
            />
          </div>
        </div>

        <NodeInspector
          node={selectedNode}
          onClose={() => setSelectedNodeId(null)}
          cellStateOverrides={cellStateOverrides}
        />

        {/* Deployments sheet — same page, not a route */}
        <Sheet open={sheet === "deployments"} onOpenChange={(open) => setSheet(open ? "deployments" : null)}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" hasCloseButton>
            <SheetHeader className="space-y-1 border-b border-black/[0.08] px-5 py-4 text-left dark:border-white/[0.08]">
              <SheetTitle className="text-base">Deployments</SheetTitle>
              <SheetDescription className="text-xs">
                Roll out by customer segment. Pin one tenant without rolling everyone back.
              </SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ReleaseCockpit release={release} paused={release.status === "paused"} />
            </div>
          </SheetContent>
        </Sheet>

        {/* Database workspace — replication, branches, compat, safe copies, schema, queries */}
        <DatabaseWorkspace
          open={sheet === "database"}
          onOpenChange={(open) => setSheet(open ? "database" : null)}
        />

        {/* Incident sheet — gated playback lives here */}
        <Sheet open={sheet === "incident"} onOpenChange={(open) => setSheet(open ? "incident" : null)}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" hasCloseButton>
            <SheetHeader className="space-y-1 border-b border-black/[0.08] px-5 py-4 text-left dark:border-white/[0.08]">
              <SheetTitle className="text-base">Incident</SheetTitle>
              <SheetDescription className="text-xs">{activeStage.summary}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <IncidentScrubber
                story={story}
                elapsedMs={elapsedMs}
                isPlaying={isPlaying}
                waitingOnGate={waitingOnGate}
                activeStageId={activeStage.id}
                formatTime={formatTime}
                onElapsedChange={setElapsedMs}
                onPlayingChange={setIsPlaying}
                onRestart={() => {
                  playback.restart();
                  resetContinuumState();
                  setCloneLabOpen(false);
                  setAgentAccessApproved(false);
                }}
              />

              {waitingOnGate && activeStage.gate != null && (
                <div className="rounded-lg border border-black/[0.08] p-4 dark:border-white/[0.08]">
                  <p className="text-[13px] font-medium">{activeStage.gate.actionLabel}</p>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{activeStage.gate.preview}</p>
                  <DesignButton size="sm" className="mt-3" onClick={handleGateAction}>
                    <PlayIcon className="mr-1.5 size-3.5" />
                    {activeStage.gate.actionLabel}
                  </DesignButton>
                </div>
              )}

              <ProtectChecklist active={protectionActive} />
              {showClosingBriefing && <ClosingBriefing closingCard={story.closingCard} />}
            </div>
          </SheetContent>
        </Sheet>

        <ForensicCloneLab
          open={cloneLabOpen}
          onOpenChange={setCloneLabOpen}
          cloneReady={continuumState.forensicCloneReady}
          waitingOnApproval={waitingOnGate && activeStage.id === "act4-clone"}
          approved={agentAccessApproved}
          onApprove={() => {
            setAgentAccessApproved(true);
            clearGate("act4-clone");
          }}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
