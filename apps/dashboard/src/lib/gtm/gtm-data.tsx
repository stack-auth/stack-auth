"use client";

import { captureError, throwErr } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { GtmDatasetTarget } from "./gtm-api";
import { getGtmDemoDataset, resolveGtmDataset } from "./gtm-data-source";
import type { GtmDataset } from "./gtm-types";

export type GtmLoadable = { status: "loading" } | { status: "error", message: string } | { status: "loaded", value: GtmDataset };
type GtmDataContextValue = { data: GtmLoadable, demo: boolean, refresh: () => Promise<void> };
const GtmDataContext = createContext<GtmDataContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `app` and `target` travel together: which app is passed decides what authorization the read can present,
 * so the caller — which is the only place that knows whether it holds the project's own admin app or the
 * dashboard's platform-admin session — picks both. See {@link GtmDatasetTarget}.
 */
export function GtmDataProvider(props: { demo: boolean, app: object, target: GtmDatasetTarget, children: React.ReactNode }) {
  const app = props.app;
  // Callers pass `target` as an object literal, so its identity changes on every render. Rebuild it from
  // its primitive fields to keep `refresh` (and therefore the load effect) from re-running on each render.
  const targetKind = props.target.kind;
  const targetProjectId = props.target.kind === "managed-project" ? props.target.projectId : null;
  const target = useMemo<GtmDatasetTarget>(
    () => targetKind === "own-project"
      ? { kind: "own-project" }
      : { kind: "managed-project", projectId: targetProjectId ?? throwErr("A managed-project GTM target must carry the project it manages.") },
    [targetKind, targetProjectId],
  );
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
      setData({ status: "loaded", value: await resolveGtmDataset(app, false, target) });
    } catch (error) {
      captureError("gtm-dashboard-load", error);
      setData({ status: "error", message: errorMessage(error) });
    }
  }, [app, props.demo, target]);

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
