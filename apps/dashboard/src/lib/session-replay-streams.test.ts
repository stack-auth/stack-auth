import { describe, expect, it } from "vitest";
import {
  NULL_TAB_KEY,
  computeGlobalTimeline,
  globalOffsetToLocalOffset,
  groupChunksIntoTabStreams,
  limitTabStreams,
  localOffsetToGlobalOffset,
  toTabKey,
} from "./session-replay-streams";

function d(ms: number) {
  return new Date(ms);
}

describe("session-replay-streams", () => {
  it("treats null sessionReplaySegmentId as its own stream", () => {
    const streams = groupChunksIntoTabStreams([
      { sessionReplaySegmentId: null, firstEventAt: d(10), lastEventAt: d(20), eventCount: 2 },
      { sessionReplaySegmentId: null, firstEventAt: d(21), lastEventAt: d(30), eventCount: 1 },
      { sessionReplaySegmentId: "a", firstEventAt: d(5), lastEventAt: d(25), eventCount: 10 },
    ]);

    expect(streams.map(s => s.tabKey).sort()).toEqual([NULL_TAB_KEY, "a"].sort());
    expect(toTabKey(null)).toBe(NULL_TAB_KEY);
  });

  it("sorts streams by lastEventAt desc then eventCount desc", () => {
    const streams = groupChunksIntoTabStreams([
      { sessionReplaySegmentId: "a", firstEventAt: d(0), lastEventAt: d(10), eventCount: 5 },
      { sessionReplaySegmentId: "b", firstEventAt: d(0), lastEventAt: d(20), eventCount: 1 },
      { sessionReplaySegmentId: "c", firstEventAt: d(0), lastEventAt: d(20), eventCount: 9 },
    ]);

    expect(streams.map(s => s.sessionReplaySegmentId)).toEqual(["c", "b", "a"]);
  });

  it("limits streams and reports hiddenCount", () => {
    const streams = groupChunksIntoTabStreams([
      { sessionReplaySegmentId: "a", firstEventAt: d(0), lastEventAt: d(10), eventCount: 1 },
      { sessionReplaySegmentId: "b", firstEventAt: d(0), lastEventAt: d(20), eventCount: 1 },
      { sessionReplaySegmentId: "c", firstEventAt: d(0), lastEventAt: d(30), eventCount: 1 },
    ]);

    const limited = limitTabStreams(streams, 2);
    expect(limited.streams).toHaveLength(2);
    expect(limited.hiddenCount).toBe(1);
  });

  it("maps global offsets to local offsets and back", () => {
    const streams = groupChunksIntoTabStreams([
      { sessionReplaySegmentId: "a", firstEventAt: d(1000), lastEventAt: d(5000), eventCount: 1 },
      { sessionReplaySegmentId: "b", firstEventAt: d(2000), lastEventAt: d(4000), eventCount: 1 },
    ]);
    const { globalStartTs } = computeGlobalTimeline(streams);

    // global offset 1500ms => absolute 2500ms.
    // Stream b starts at 2000ms => local 500ms.
    const local = globalOffsetToLocalOffset(globalStartTs, 2000, 1500);
    expect(local).toBe(500);

    const roundTripGlobal = localOffsetToGlobalOffset(globalStartTs, 2000, local);
    expect(roundTripGlobal).toBe(1500);
  });
});

