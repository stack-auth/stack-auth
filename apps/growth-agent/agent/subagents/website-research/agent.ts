import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";


export default defineAgent({
  description: "Researches a customer project's public website and competitor landscape: extracts positioning, audience, and feature information from the live site, identifies 2-4 competitors, and saves structured findings, a crawl summary artifact, and a brand kit (palette/typography/tone/imagery style plus a homepage screenshot) back to the Hexclave backend.",
  ...getGrowthModelConfig(),
});
