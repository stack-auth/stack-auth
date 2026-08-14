import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";

// Declared subagents inherit nothing from the root agent (see eve's subagents
// docs: each `agent/subagents/<id>/` directory is its own agent root), so this
// file must declare its own model. It resolves through the SAME helper the root
// agent uses, so `HEXCLAVE_GROWTH_MODEL` and the gateway provider order move
// every growth agent at once — hardcoding it here used to leave subagents
// behind whenever the root changed.
export default defineAgent({
  description: "Composes the final growth report for an analysis run: reads the accumulated context bundle (findings, artifacts, interview answers), writes an insight-dense markdown report with structured sections, and attaches 2-5 concrete action items (run_ads / publish_blog / custom), saved through its own tools.",
  ...getGrowthModelConfig(),
});
