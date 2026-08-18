"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchTvSnapshotOrThrow } from "@/lib/hexclave-app-internals";
import {
  TV_SNAPSHOT_POLL_INTERVAL_MS,
  type TvSnapshot,
} from "@/lib/tv-mode/types";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { captureError, HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export type TvLiveSnapshotState = {
  snapshot: TvSnapshot | null,
  loading: boolean,
  unavailableReason: "offline" | "error" | null,
};

export function getRetainedSnapshotState(
  snapshot: TvSnapshot,
  now: Date,
  online: boolean,
): TvSnapshot {
  return {
    ...snapshot,
    connectionStatus: online
      ? now.getTime() >= new Date(snapshot.staleAfter).getTime() ? "stale" : "online"
      : "offline",
  };
}

export function useTvLiveSnapshot(options: {
  adminApp: object,
  profileId: string,
  enabled: boolean,
}): TvLiveSnapshotState {
  const loadSnapshot = useCallback(async () => {
    return await fetchTvSnapshotOrThrow(options.adminApp, options.profileId);
  }, [options.adminApp, options.profileId]);
  return useTvSnapshotPolling({
    loadSnapshot,
    enabled: options.enabled,
    failureProfileId: options.profileId,
  });
}

export function useTvSnapshotPolling(options: {
  loadSnapshot: () => Promise<TvSnapshot>,
  enabled: boolean,
  failureProfileId?: string,
}): TvLiveSnapshotState {
  const { enabled, failureProfileId, loadSnapshot } = options;
  const [snapshot, setSnapshot] = useState<TvSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [unavailableReason, setUnavailableReason] = useState<"offline" | "error" | null>(null);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const snapshotRef = useRef<TvSnapshot | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = ++requestIdRef.current;
    try {
      const nextSnapshot = await loadSnapshot();
      if (requestId !== requestIdRef.current) return;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setUnavailableReason(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      captureError("tv-snapshot-refresh-failed", new HexclaveAssertionError(
        "Failed to refresh the TV presentation snapshot.",
        { cause, profileId: failureProfileId },
      ));
      const retained = snapshotRef.current;
      if (retained == null) {
        setUnavailableReason(navigator.onLine ? "error" : "offline");
      } else {
        const nextSnapshot = getRetainedSnapshotState(retained, new Date(), navigator.onLine);
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setLoading(false);
      }
    }
  }, [enabled, failureProfileId, loadSnapshot]);

  useEffect(() => {
    // Route or display-principal changes can reuse this client component.
    // Invalidate the previous source so its response cannot cross boundaries.
    requestIdRef.current += 1;
    inFlightRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setUnavailableReason(null);
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        runAsynchronously(refresh());
      }
    };
    const updateConnectionState = () => {
      const retained = snapshotRef.current;
      if (retained == null) {
        if (navigator.onLine) {
          runAsynchronously(refresh());
        } else {
          setUnavailableReason("offline");
        }
        return;
      }
      const nextSnapshot = getRetainedSnapshotState(retained, new Date(), navigator.onLine);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      if (navigator.onLine) runAsynchronously(refresh());
    };
    const updateFreshness = () => {
      const retained = snapshotRef.current;
      if (retained == null) return;
      const nextSnapshot = getRetainedSnapshotState(retained, new Date(), navigator.onLine);
      if (nextSnapshot.connectionStatus !== retained.connectionStatus) {
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
      }
    };
    const interval = window.setInterval(refreshIfVisible, TV_SNAPSHOT_POLL_INTERVAL_MS);
    const freshnessInterval = window.setInterval(updateFreshness, 5_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);
    runAsynchronously(refresh());

    return () => {
      window.clearInterval(interval);
      window.clearInterval(freshnessInterval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, [enabled, refresh]);

  return { snapshot, loading, unavailableReason };
}
