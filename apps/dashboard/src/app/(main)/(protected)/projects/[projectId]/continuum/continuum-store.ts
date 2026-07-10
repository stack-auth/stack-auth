import type { CellState, RolloutStageStatus } from "./fixtures/types";

export type ContinuumDemoState = {
  cellStates: Map<string, CellState>,
  releaseStatus: "draft" | "rolling_out" | "paused" | "complete",
  stageStatuses: Map<string, RolloutStageStatus>,
  pinnedVersions: Map<string, string>,
  incidentBanner: string | null,
  deferredReleased: boolean,
  forensicCloneReady: boolean,
};

type Listener = () => void;

const listeners = new Set<Listener>();

function createInitialState(): ContinuumDemoState {
  return {
    cellStates: new Map(),
    releaseStatus: "draft",
    stageStatuses: new Map([
      ["stage-1", "pending"],
      ["stage-2", "pending"],
      ["stage-3", "pending"],
      ["stage-4", "pending"],
      ["stage-5", "pending"],
    ]),
    pinnedVersions: new Map(),
    incidentBanner: null,
    deferredReleased: false,
    forensicCloneReady: false,
  };
}

let state: ContinuumDemoState = createInitialState();

export function getContinuumState(): ContinuumDemoState {
  return state;
}

export function subscribeContinuum(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function patchContinuumState(patch: Partial<ContinuumDemoState> | ((prev: ContinuumDemoState) => ContinuumDemoState)) {
  state = typeof patch === "function" ? patch(state) : { ...state, ...patch };
  emit();
}

export function resetContinuumState() {
  state = createInitialState();
  emit();
}

export function setCellState(cellId: string, cellState: CellState) {
  patchContinuumState((prev) => {
    const cellStates = new Map(prev.cellStates);
    cellStates.set(cellId, cellState);
    return { ...prev, cellStates };
  });
}

export function setIncidentBanner(message: string | null) {
  patchContinuumState({ incidentBanner: message });
}
