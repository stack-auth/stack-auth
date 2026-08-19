import { describe, expect, it } from "vitest";
import { buildPhaseContinuationToken, parsePhaseContinuationToken, type PhaseSessionIdentity } from "#lib/phase-continuation.ts";

/**
 * This token is the entire input to phase settlement: get it wrong and a phase either never
 * completes (the run stalls until the backend reaps it) or completes on the wrong signal (a
 * subagent finishing marks the phase done while its real work is still running). Both failures are
 * invisible in code review, so the round trip and every rejection case are pinned here.
 */

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
    // The reason the parser reads from both ends: `analysis:icp-visitor-outreach` is one key, and a
    // positional split would truncate it to "analysis" and shift every field after it.
    const topic = { ...identity, phase_key: "analysis:icp-visitor-outreach" };
    expect(parsePhaseContinuationToken(buildPhaseContinuationToken(topic))).toEqual(topic);
  });

  it("reads a token eve has namespaced with the channel name", () => {
    // What the handlers actually receive: eve prefixes the channel-local token before storing it.
    expect(parsePhaseContinuationToken(`growth:${buildPhaseContinuationToken(identity)}`)).toEqual(identity);
  });

  it("ignores the other run kinds, which share these handlers", () => {
    // Every session on the channel reaches the terminal-event handlers, so these must not settle
    // anything — an interview turn completing is not a phase completing.
    for (const token of ["growth:interview:run_1:turn:3", "growth:chat:turn_9", "growth:quiz:round_2", "growth:blog-draft:action_7", "growth:brief:brief_4"]) {
      expect(parsePhaseContinuationToken(token)).toBeNull();
    }
  });

  it("ignores the previous token layout instead of mis-reading it", () => {
    // The load-bearing case for versioning the marker. Under the old `run:<run>:<phase>:<attempt>`
    // layout this parser would otherwise read the run id as a project id and settle a phase against
    // a project that does not exist. A session in flight across the deploy must be unrecognised.
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
    // The backend dispatches attempt 1 first, but nothing in the contract forbids 0, and a falsy
    // check here would silently drop it.
    const first = { ...identity, attempt: 0 };
    expect(parsePhaseContinuationToken(buildPhaseContinuationToken(first))).toEqual(first);
  });
});
