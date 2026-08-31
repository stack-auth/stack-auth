import { describe, expect, it } from "vitest";
import { buildPhaseContinuationToken, parsePhaseContinuationToken, type PhaseSessionIdentity } from "#lib/phase-continuation.ts";

const identity: PhaseSessionIdentity = {
  project_id: "proj_1",
  branch_id: "main",
  run_id: "3ac4c1f4-29af-41a8-a2e6-cf0f0c8b3fb8",
  phase_key: "report",
  attempt: 1,
};

describe("phase continuation tokens", () => {
  it("round-trips a plain phase key", () => {
    expect(buildPhaseContinuationToken(identity)).toMatchInlineSnapshot(`"phase1:proj_1:main:3ac4c1f4-29af-41a8-a2e6-cf0f0c8b3fb8:report:1"`);
    expect(parsePhaseContinuationToken(buildPhaseContinuationToken(identity))).toEqual(identity);
  });

  it("round-trips an analysis topic, whose key contains the separator", () => {
    const topic = { ...identity, phase_key: "analysis:icp-visitor-outreach" };
    expect(parsePhaseContinuationToken(buildPhaseContinuationToken(topic))).toEqual(topic);
  });

  it("rejects colon-bearing project, branch, and run IDs", () => {
    expect(() => buildPhaseContinuationToken({ ...identity, project_id: "proj:1" })).toThrow("must not contain ':'");
    expect(() => buildPhaseContinuationToken({ ...identity, branch_id: "main:1" })).toThrow("must not contain ':'");
    expect(() => buildPhaseContinuationToken({ ...identity, run_id: "run:1" })).toThrow("must not contain ':'");
  });

  it("reads a token eve has namespaced with the channel name", () => {
    expect(parsePhaseContinuationToken(`growth:${buildPhaseContinuationToken(identity)}`)).toEqual(identity);
  });

  it("ignores the other run kinds, which share these handlers", () => {
    for (const token of ["growth:interview:run_1:turn:3", "growth:chat:turn_9", "growth:quiz:round_2", "growth:blog-draft:action_7", "growth:brief:brief_4"]) {
      expect(parsePhaseContinuationToken(token)).toBeNull();
    }
  });

  it("ignores the previous token layout instead of mis-reading it", () => {
    expect(parsePhaseContinuationToken("growth:run:3ac4c1f4-29af-41a8-a2e6-cf0f0c8b3fb8:report:1")).toBeNull();
  });

  it("rejects tokens that are too short or whose attempt is not a number", () => {
    expect(parsePhaseContinuationToken("phase1:proj_1:main:run_1")).toBeNull();
    expect(parsePhaseContinuationToken("phase1:proj_1:main:run_1:report:not-a-number")).toBeNull();
    expect(parsePhaseContinuationToken("phase1:proj_1:main:run_1:report:")).toBeNull();
  });

  it("rejects a token with an empty identity segment", () => {
    expect(parsePhaseContinuationToken("phase1::main:run_1:report:1")).toBeNull();
    expect(parsePhaseContinuationToken("phase1:proj_1:main::report:1")).toBeNull();
  });

  it("keeps attempt 0 settleable", () => {
    const first = { ...identity, attempt: 0 };
    expect(parsePhaseContinuationToken(buildPhaseContinuationToken(first))).toEqual(first);
  });
});
