import { defineAgent } from "eve";
import { getGrowthModelConfig } from "#lib/model.ts";


export default defineAgent({
  description: "Mines the project's analytics data (all project-scoped ClickHouse tables via SQL — events, users, teams, email_outboxes, the growth_daily_metrics store, and more — plus the metrics endpoint and the growth metrics context) for growth patterns: signup trends, activation drop-offs, traffic quality, and email engagement. Saves data-insight and metric-baseline findings with concrete numbers.",
  ...getGrowthModelConfig(),
});
