import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";

// Declared subagents inherit nothing from the root agent (see eve's subagents
// docs: each `agent/subagents/<id>/` directory is its own agent root), so this
// file must declare its own model. It resolves through the SAME helper the root
// agent uses, so `HEXCLAVE_GROWTH_MODEL` and the gateway provider order move
// every growth agent at once — hardcoding it here used to leave subagents
// behind whenever the root changed.
export default defineAgent({
  description: "Researches a customer project's public website and competitor landscape: extracts positioning, audience, and feature information from the live site, identifies 2-4 competitors, and saves structured findings, a crawl summary artifact, and a brand kit (palette/typography/tone/imagery style plus a homepage screenshot) back to the Hexclave backend.",
  ...getGrowthModelConfig(),
});
