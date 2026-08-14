"use client";

import { captureError } from "@hexclave/shared/dist/utils/errors";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getGrowthStatus } from "./growth-api";
import { buildGrowthDemoStatus, GROWTH_DEMO_NOW_MILLIS } from "./growth-demo-data";
import { getGrowthStatusPollIntervalMillis, type GrowthPhase } from "./growth-status";
import type { GrowthStatus } from "./growth-types";

export type GrowthLoadable<T> = { status: "loading" } | { status: "error", message: string } | { status: "loaded", value: T };

type GrowthStatusContextValue = {
  data: GrowthLoadable<GrowthStatus>,
  demo: boolean,
  refresh: () => Promise<void>,
};

const GrowthStatusContext = createContext<GrowthStatusContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Loads the single `/internal/growth/status` snapshot every growth page derives its lifecycle state from.
 * `app` must be the project's own admin app (see `growth-api.ts` for the authorization story). In demo mode
 * the provider short-circuits to fixtures for `demoPhase` and never hits the network.
 *
 * While the snapshot is still advancing on its own, the provider re-polls
 * on an interval; everywhere else the next change needs the user, so polling there would be wasted requests.
 */
export function GrowthStatusProvider(props: { demo: boolean, demoPhase: GrowthPhase, app: object, children: React.ReactNode }) {
  const { demo, demoPhase, app } = props;
  const [data, setData] = useState<GrowthLoadable<GrowthStatus>>(() => demo
    ? { status: "loaded", value: buildGrowthDemoStatus(demoPhase, GROWTH_DEMO_NOW_MILLIS) }
    : { status: "loading" });

  const refresh = useCallback(async () => {
    if (demo) {
      setData({ status: "loaded", value: buildGrowthDemoStatus(demoPhase, GROWTH_DEMO_NOW_MILLIS) });
      return;
    }
    try {
      setData({ status: "loaded", value: await getGrowthStatus(app) });
    } catch (error) {
      captureError("growth-status-load", error);
      setData({ status: "error", message: errorMessage(error) });
    }
  }, [app, demo, demoPhase]);

  useEffect(() => {
    // Show the loading skeleton on target changes (demo toggles, app identity), but not on background
    // polls — the poll below reuses `refresh`, which intentionally leaves stale data visible until the
    // fresh snapshot arrives so the analyzing checklist doesn't flicker every few seconds.
    if (!demo) setData({ status: "loading" });
    runAsynchronously(refresh());
  }, [refresh, demo]);

  const pollIntervalMillis = data.status === "loaded" ? getGrowthStatusPollIntervalMillis(data.value) : null;
  useEffect(() => {
    if (demo || pollIntervalMillis == null) return;
    const interval = setInterval(() => runAsynchronously(refresh()), pollIntervalMillis);
    return () => clearInterval(interval);
  }, [pollIntervalMillis, demo, refresh]);

  /**
   * Refresh the moment this tab regains focus, on top of the interval above.
   *
   * The case this exists for: the integrations step opens Meta's connect flow in a NEW tab, so the
   * user connects elsewhere and switches back here. Waiting out the remainder of a 7s tick makes the
   * page look like it did not notice — which is exactly the moment they are checking whether it
   * worked. Focus is the cheap, accurate signal that they came back.
   *
   * Gated on the same polling window as the interval: a settled run has nothing to re-poll,
   * and refreshing on every tab switch forever would be a pointless request on every growth page.
   */
  useEffect(() => {
    if (demo || pollIntervalMillis == null) return;
    const onFocus = () => runAsynchronously(refresh());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [pollIntervalMillis, demo, refresh]);

  const value = useMemo(() => ({ data, demo, refresh }), [data, demo, refresh]);
  return <GrowthStatusContext.Provider value={value}>{props.children}</GrowthStatusContext.Provider>;
}

export function useGrowthStatus(): GrowthStatusContextValue {
  const context = useContext(GrowthStatusContext);
  if (context == null) throw new Error("useGrowthStatus must be used inside GrowthStatusProvider");
  return context;
}
