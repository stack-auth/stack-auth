"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type SelectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
};

export type RecipientsState = {
  scope: "all" | "users",
  selectedUsers: SelectedUser[],
};

export type ScheduleState = {
  mode: "immediate" | "scheduled",
  date: string,
  time: string,
};

export type DraftFlowState = {
  recipients: RecipientsState,
  schedule: ScheduleState,
};

type DraftFlowContextValue = {
  flowState: DraftFlowState,
  updateRecipients: (data: Partial<RecipientsState>) => void,
  updateSchedule: (data: Partial<ScheduleState>) => void,
  resetFlowState: () => void,
};

const DraftFlowContext = createContext<DraftFlowContextValue | null>(null);

const DEFAULT_FLOW_STATE: DraftFlowState = {
  recipients: { scope: "all", selectedUsers: [] },
  schedule: { mode: "immediate", date: "", time: "" },
};

function getStorageKey(draftId: string): string {
  return `draft-flow-state-${draftId}`;
}

function loadFlowStateFromStorage(draftId: string): DraftFlowState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(getStorageKey(draftId));
    if (stored) {
      return JSON.parse(stored) as DraftFlowState;
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function saveFlowStateToStorage(draftId: string, state: DraftFlowState): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(getStorageKey(draftId), JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function clearFlowStateFromStorage(draftId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(getStorageKey(draftId));
  } catch {
    // Ignore storage errors
  }
}

export function DraftFlowProvider({
  draftId,
  children,
}: {
  draftId: string,
  children: React.ReactNode,
}) {
  const [flowState, setFlowState] = useState<DraftFlowState>(() => {
    return loadFlowStateFromStorage(draftId) ?? DEFAULT_FLOW_STATE;
  });

  // Sync to sessionStorage when state changes
  useEffect(() => {
    saveFlowStateToStorage(draftId, flowState);
  }, [draftId, flowState]);

  const updateRecipients = useCallback((data: Partial<RecipientsState>) => {
    setFlowState((prev) => ({
      ...prev,
      recipients: { ...prev.recipients, ...data },
    }));
  }, []);

  const updateSchedule = useCallback((data: Partial<ScheduleState>) => {
    setFlowState((prev) => ({
      ...prev,
      schedule: { ...prev.schedule, ...data },
    }));
  }, []);

  const resetFlowState = useCallback(() => {
    setFlowState(DEFAULT_FLOW_STATE);
    clearFlowStateFromStorage(draftId);
  }, [draftId]);

  const contextValue = useMemo((): DraftFlowContextValue => ({
    flowState,
    updateRecipients,
    updateSchedule,
    resetFlowState,
  }), [flowState, updateRecipients, updateSchedule, resetFlowState]);

  return (
    <DraftFlowContext.Provider value={contextValue}>
      {children}
    </DraftFlowContext.Provider>
  );
}

export function useDraftFlow(): DraftFlowContextValue {
  const ctx = useContext(DraftFlowContext);
  if (!ctx) {
    throw new Error("useDraftFlow must be used within DraftFlowProvider");
  }
  return ctx;
}
