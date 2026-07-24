"use client";

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { useStackApp } from "@hexclave/next";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getGtmDemoDataset, resolveGtmDataset } from "./gtm-data-source";
import type { GtmDataset } from "./gtm-types";

export type GtmLoadable = { status: "loading" } | { status: "error", message: string } | { status: "loaded", value: GtmDataset };
type GtmDataContextValue = { data: GtmLoadable, demo: boolean, refresh: () => Promise<void> };
const GtmDataContext = createContext<GtmDataContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function GtmDataProvider(props: { demo: boolean, projectId?: string, children: React.ReactNode }) {
  const app = useStackApp();
  const [data, setData] = useState<GtmLoadable>(() => props.demo
    ? { status: "loaded", value: getGtmDemoDataset() }
    : { status: "loading" });

  const refresh = useCallback(async () => {
    if (props.demo) {
      setData({ status: "loaded", value: getGtmDemoDataset() });
      return;
    }
    setData({ status: "loading" });
    try {
      setData({ status: "loaded", value: await resolveGtmDataset(app, false, props.projectId) });
    } catch (error) {
      captureError("gtm-dashboard-load", error);
      setData({ status: "error", message: errorMessage(error) });
    }
  }, [app, props.demo, props.projectId]);

  useEffect(() => {
    runAsynchronously(refresh());
  }, [refresh]);

  const value = useMemo(() => ({ data, demo: props.demo, refresh }), [data, props.demo, refresh]);
  return <GtmDataContext.Provider value={value}>{props.children}</GtmDataContext.Provider>;
}

export function useGtmData(): GtmDataContextValue {
  const context = useContext(GtmDataContext);
  if (context == null) throw new Error("useGtmData must be used inside GtmDataProvider");
  return context;
}
