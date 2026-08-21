import { defineEval } from "eve/evals";

// Manual/nightly smoke eval -- NOT CI-blocking. See evals/README.md: it needs
// a live model (the root agent has no mock fixture) and a running Hexclave
// backend for the data-analyst's tools to hit, so it is meant to be run by
// hand with `pnpm exec eve eval` against a full dev environment.
export default defineEval({
  description: "The root agent delegates a data-analysis request to the data-analyst subagent, which attempts a sql-query tool call.",
  tags: ["manual", "nightly", "requires-live-model"],
  async test(t) {
    // The eval boots the agent server in-process, so the tool env is this
    // process's env. Without a backend URL every data-analyst tool call throws
    // before proving anything, so skip cleanly instead of failing noisily
    // (this also keeps an accidental CI invocation green).
    if (process.env.HEXCLAVE_GROWTH_BACKEND_URL == null || process.env.HEXCLAVE_GROWTH_AGENT_API_SECRET == null) {
      t.skip("HEXCLAVE_GROWTH_BACKEND_URL / HEXCLAVE_GROWTH_AGENT_API_SECRET not set; this smoke eval needs a live Hexclave backend");
    }

    await t.send(
      "Delegate the following task to your data-analyst subagent (do not answer it yourself): "
      + "analyze signup trends for the Hexclave project with project_id \"internal\" and branch_id \"main\". "
      + "There is no run_id for this ad-hoc analysis, so do not save findings; just report what the data shows.",
    );

    t.succeeded();
    // The delegation itself is the hard gate: the frozen subagent id
    // "data-analyst" must be visible and chosen by the root agent.
    t.calledSubagent("data-analyst");
    // Whether the child's own tool calls surface in the parent stream depends
    // on the delegation path (inline `subagent.event` wrappers vs. a separate
    // child-session stream), so the sql-query attempt is tracked soft rather
    // than gated: a hit proves the analyst reached for real data, a miss does
    // not fail the eval on stream-shape grounds.
    t.eventsSatisfy("data-analyst attempted a sql-query tool call", (events) =>
      events.some((event) =>
        event.type === "subagent.event"
        && event.data.subagentName === "data-analyst"
        && event.data.event.type === "actions.requested"
        && event.data.event.data.actions.some((action) => action.kind === "tool-call" && action.toolName === "sql-query"),
      ),
    ).soft();
  },
});
