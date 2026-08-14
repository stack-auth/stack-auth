import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";

// Declared subagents inherit nothing from the root agent (see eve's subagents
// docs: each `agent/subagents/<id>/` directory is its own agent root), so this
// file must declare its own model. It resolves through the SAME helper the root
// agent uses, so `HEXCLAVE_GROWTH_MODEL` and the gateway provider order move
// every growth agent at once — hardcoding it here used to leave subagents
// behind whenever the root changed.
export default defineAgent({
  description: "Mines the project's analytics data (all project-scoped ClickHouse tables via SQL — events, users, teams, email_outboxes, the growth_daily_metrics store, and more — plus the metrics endpoint and the growth metrics context) for growth patterns: signup trends, activation drop-offs, traffic quality, and email engagement. Saves data-insight and metric-baseline findings with concrete numbers.",
  ...getGrowthModelConfig(),
});
