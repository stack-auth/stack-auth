"use client";

import type { GtmAction, GtmInsight, GtmNote } from "@/lib/gtm/gtm-types";
import { createContext, useContext, type ReactNode } from "react";

export type GtmAdminControls = {
  editInsight: (insight: GtmInsight) => void,
  editAction: (action: GtmAction) => void,
  editNote: (note: GtmNote) => void,
};

const GtmAdminContext = createContext<GtmAdminControls | null>(null);

export function GtmAdminControlsProvider(props: { value: GtmAdminControls, children: ReactNode }) {
  return <GtmAdminContext.Provider value={props.value}>{props.children}</GtmAdminContext.Provider>;
}

export function useOptionalGtmAdminControls(): GtmAdminControls | null {
  return useContext(GtmAdminContext);
}
