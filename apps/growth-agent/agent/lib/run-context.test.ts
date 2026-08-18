import { describe, expect, it } from "vitest";
import {
  buildGrowthSessionAuth,
  GROWTH_CHAT_PHASE_KEY,
  GROWTH_INTERVIEW_PHASE_KEY,
  type GrowthAuthCarrierContext,
  type GrowthSessionAuthInput,
  readGrowthRunContext,
} from "#lib/run-context.ts";

const PROJECT_ID = "proj_1";
const BRANCH_ID = "main";

/**
 * A session context carrying exactly what the dispatch code would have put there. Built by running
 * the REAL `buildGrowthSessionAuth`, so these tests exercise the write and read halves together —
 * a change that renames an attribute on one side fails here rather than in production.
 */
function contextFor(input: GrowthSessionAuthInput): GrowthAuthCarrierContext {
  return { session: { auth: { current: buildGrowthSessionAuth(input), initiator: null } } };
}

const analysisInput: GrowthSessionAuthInput = {
  project_id: PROJECT_ID,
  branch_id: BRANCH_ID,
  finding_source: "report",
  run_id: "run_1",
  phase_key: "report",
  agent_token: "grt_test",
};

describe("readGrowthRunContext", () => {
  it("reads back what the dispatch code wrote, for an ordinary analysis session", () => {
    expect(readGrowthRunContext(contextFor(analysisInput))).toEqual({
      project_id: PROJECT_ID,
      branch_id: BRANCH_ID,
      finding_source: "report",
      run_id: "run_1",
      phase_key: "report",
      brief_date: undefined,
    });
  });

  it("reads back the chat and interview sentinels as themselves", () => {
    for (const phaseKey of [GROWTH_CHAT_PHASE_KEY, GROWTH_INTERVIEW_PHASE_KEY]) {
      const context = contextFor({ ...analysisInput, phase_key: phaseKey });
      expect(readGrowthRunContext(context).phase_key).toBe(phaseKey);
    }
  });

  it("survives the delegation hop, where the dispatch auth arrives as `initiator`", () => {
    // Declared subagents see the dispatch auth as `initiator` rather than `current`. Every root tool
    // resolves its project through this function, so losing the context across that hop would break
    // delegated tool calls entirely — and it is also the hop a future per-session-kind deny (see the
    // function's own comment) has to survive, or delegating would launder the restriction away.
    const context: GrowthAuthCarrierContext = {
      session: { auth: { current: null, initiator: buildGrowthSessionAuth(analysisInput) } },
    };
    expect(readGrowthRunContext(context).project_id).toBe(PROJECT_ID);
  });

  it("refuses a session that was not started by the growth dispatch code", () => {
    const context = { session: { auth: { current: null, initiator: null } } } as GrowthAuthCarrierContext;
    expect(() => readGrowthRunContext(context)).toThrow(/carries no growth run context/);
  });
});
