// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTvFixtureSnapshot, getTvProfileFixture } from "./fixtures";
import { useTvLiveSnapshot, type TvLiveSnapshotState } from "./live-snapshot";

const fetchTvSnapshotMock = vi.hoisted(() => vi.fn());
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

vi.mock("@/lib/hexclave-app-internals", () => ({
  fetchTvSnapshotOrThrow: fetchTvSnapshotMock,
}));

const profile = getTvProfileFixture("company-pulse");
if (profile == null) throw new Error("Missing company-pulse fixture profile");
const snapshot = createTvFixtureSnapshot("project", profile);
const ADMIN_APP = {};

function Probe({
  onState,
  profileId = "company-pulse",
}: {
  onState: (state: TvLiveSnapshotState) => void,
  profileId?: string,
}) {
  const state = useTvLiveSnapshot({
    adminApp: ADMIN_APP,
    profileId,
    enabled: true,
  });
  onState(state);
  return null;
}

describe("useTvLiveSnapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchTvSnapshotMock.mockReset();
    fetchTvSnapshotMock.mockResolvedValue(snapshot);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls without overlap, pauses while hidden, and refreshes on restoration", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const observedStates: TvLiveSnapshotState[] = [];

    await act(async () => {
      root.render(<Probe onState={(state) => {
        observedStates.push(state);
      }} />);
      await Promise.resolve();
    });
    expect(fetchTvSnapshotMock).toHaveBeenCalledTimes(1);
    expect(observedStates.at(-1)?.snapshot?.project.id).toBe("project");

    const pendingSnapshot = Promise.withResolvers<typeof snapshot>();
    fetchTvSnapshotMock.mockReturnValueOnce(pendingSnapshot.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchTvSnapshotMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchTvSnapshotMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      pendingSnapshot.resolve(snapshot);
      await Promise.resolve();
    });

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchTvSnapshotMock).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(fetchTvSnapshotMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(fetchTvSnapshotMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      root.unmount();
    });
  });

  it("shows initial offline failure and recovers immediately when the browser reconnects", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    fetchTvSnapshotMock.mockRejectedValueOnce(new Error("offline"));
    const container = document.createElement("div");
    const root = createRoot(container);
    const observedStates: TvLiveSnapshotState[] = [];

    await act(async () => {
      root.render(<Probe onState={(state) => {
        observedStates.push(state);
      }} />);
      await Promise.resolve();
    });
    expect(observedStates.at(-1)).toMatchObject({
      snapshot: null,
      loading: false,
      unavailableReason: "offline",
    });

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await Promise.resolve();
    });
    expect(observedStates.at(-1)).toMatchObject({
      snapshot: { project: { id: "project" }, connectionStatus: "online" },
      loading: false,
      unavailableReason: null,
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("marks retained data stale and offline without discarding it", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const observedStates: TvLiveSnapshotState[] = [];

    await act(async () => {
      root.render(<Probe onState={(state) => {
        observedStates.push(state);
      }} />);
      await Promise.resolve();
    });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(observedStates.at(-1)?.snapshot).toMatchObject({
      project: { id: "project" },
      connectionStatus: "stale",
    });

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(observedStates.at(-1)?.snapshot).toMatchObject({
      project: { id: "project" },
      connectionStatus: "offline",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("discards an older profile response when the route changes", async () => {
    const oldResponse = Promise.withResolvers<typeof snapshot>();
    const newSnapshot = {
      ...snapshot,
      profile: { ...snapshot.profile, id: "engineering-office" },
    };
    fetchTvSnapshotMock
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(newSnapshot);
    const container = document.createElement("div");
    const root = createRoot(container);
    const observedStates: TvLiveSnapshotState[] = [];
    const onState = (state: TvLiveSnapshotState) => {
      observedStates.push(state);
    };

    await act(async () => {
      root.render(<Probe onState={onState} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Probe onState={onState} profileId="engineering-office" />);
      await Promise.resolve();
    });
    expect(fetchTvSnapshotMock).toHaveBeenNthCalledWith(2, ADMIN_APP, "engineering-office");

    await act(async () => {
      oldResponse.resolve(snapshot);
      await Promise.resolve();
    });
    expect(observedStates.at(-1)?.snapshot?.profile.id).toBe("engineering-office");

    await act(async () => {
      root.unmount();
    });
  });
});
