import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";


export default defineAgent({
  description: "Composes the final growth report for an analysis run: reads the accumulated context bundle (findings, artifacts, interview answers), writes an insight-dense markdown report with structured sections, and attaches 2-5 concrete action items (run_ads / publish_blog / custom), saved through its own tools.",
  ...getGrowthModelConfig(),
});
