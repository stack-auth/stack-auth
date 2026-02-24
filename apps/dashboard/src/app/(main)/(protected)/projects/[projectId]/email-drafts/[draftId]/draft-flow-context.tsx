"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

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

export function DraftFlowProvider({
  children,
}: {
  children: React.ReactNode,
}) {
  const [flowState, setFlowState] = useState<DraftFlowState>(DEFAULT_FLOW_STATE);

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
  }, []);

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
