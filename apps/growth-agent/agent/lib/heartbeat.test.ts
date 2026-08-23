import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPhaseContinuationToken, type PhaseSessionIdentity } from "#lib/phase-continuation.ts";

const phaseHeartbeat = vi.fn<(input: PhaseSessionIdentity) => Promise<unknown>>();

vi.mock("#lib/hexclave-client.ts", () => ({
  phaseHeartbeat: (input: PhaseSessionIdentity) => phaseHeartbeat(input),
}));

const { hasKeepaliveExpired, noteGrowthPhaseProgress, shouldBeatPhaseNow, stopGrowthPhaseHeartbeat } = await import("#lib/heartbeat.ts");

const identity: PhaseSessionIdentity = {
  project_id: "proj_1",
  branch_id: "main",
  run_id: "3ac4c1f4-29af-41a8-a2e6-cf0f0c8b3fb8",
  phase_key: "analysis:icp",
  attempt: 1,
};

function channelFor(token: string | null) {
  return token == null ? {} : { continuation: { token } };
}

// The heartbeat detaches its backend call, so a beat is observable only after the microtask queue
// drains; awaiting a resolved promise is enough since the mock never suspends.
async function settleDetachedBeats(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("phase heartbeat scheduling", () => {
  it("beats on the first progress event of a session", () => {
    expect(shouldBeatPhaseNow(null, 5_000)).toBe(true);
  });

  it("skips progress events that arrive within the throttle window", () => {
    expect(shouldBeatPhaseNow(5_000, 5_001)).toBe(false);
    expect(shouldBeatPhaseNow(5_000, 64_999)).toBe(false);
  });

  it("beats again once the window has elapsed, well inside the backend's 15 minute reap window", () => {
    expect(shouldBeatPhaseNow(5_000, 65_000)).toBe(true);
    expect(shouldBeatPhaseNow(5_000, 900_000)).toBe(true);
  });

  it("gives up on a session whose terminal event never arrived", () => {
    expect(hasKeepaliveExpired(1_000, 1_000 + 6 * 3_600_000 - 1)).toBe(false);
    expect(hasKeepaliveExpired(1_000, 1_000 + 6 * 3_600_000)).toBe(true);
  });
});

describe("phase heartbeat from session events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    phaseHeartbeat.mockReset();
    phaseHeartbeat.mockResolvedValue(undefined);
  });

  afterEach(() => {
    stopGrowthPhaseHeartbeat(channelFor(buildPhaseContinuationToken(identity)));
    vi.useRealTimers();
  });

  it("beats for the phase named by the session's continuation token", async () => {
    noteGrowthPhaseProgress(channelFor(buildPhaseContinuationToken(identity)));
    await settleDetachedBeats();

    expect(phaseHeartbeat.mock.calls).toEqual([[identity]]);
  });

  it("ignores sessions that carry no phase token", async () => {
    noteGrowthPhaseProgress(channelFor(null));
    noteGrowthPhaseProgress(channelFor("chat:proj_1:main:turn_1"));
    await settleDetachedBeats();

    expect(phaseHeartbeat).not.toHaveBeenCalled();
  });

  it("keeps beating while a tool call runs without emitting any event", async () => {
    noteGrowthPhaseProgress(channelFor(buildPhaseContinuationToken(identity)));
    await settleDetachedBeats();
    expect(phaseHeartbeat).toHaveBeenCalledTimes(1);

    // Ten silent minutes: without the timer the backend would be about to reap this phase.
    for (let minute = 0; minute < 10; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
    }

    expect(phaseHeartbeat).toHaveBeenCalledTimes(11);
  });

  it("throttles a burst of progress events down to one beat", async () => {
    for (let event = 0; event < 5; event++) {
      noteGrowthPhaseProgress(channelFor(buildPhaseContinuationToken(identity)));
      await settleDetachedBeats();
    }

    expect(phaseHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("stops beating once the session settles", async () => {
    noteGrowthPhaseProgress(channelFor(buildPhaseContinuationToken(identity)));
    await settleDetachedBeats();
    stopGrowthPhaseHeartbeat(channelFor(buildPhaseContinuationToken(identity)));

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(phaseHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("retries on the next interval after a failed beat instead of throwing at the event handler", async () => {
    phaseHeartbeat.mockRejectedValueOnce(new Error("backend unavailable"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    noteGrowthPhaseProgress(channelFor(buildPhaseContinuationToken(identity)));
    await settleDetachedBeats();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(phaseHeartbeat).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
