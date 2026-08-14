import { defineEvalConfig } from "eve/evals";

// No judge model: the current evals are deterministic (run/tool/subagent
// assertions only), so there is nothing for an LLM-as-judge to grade. Add a
// `judge` here when a fuzzy content check first needs one.
export default defineEvalConfig({
  // The smoke evals drive a live model end-to-end, so give them headroom over
  // the default per-eval timeout.
  timeoutMs: 300_000,
});
