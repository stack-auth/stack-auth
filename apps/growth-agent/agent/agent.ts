import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";

export default defineAgent({
  ...getGrowthModelConfig(),
});
