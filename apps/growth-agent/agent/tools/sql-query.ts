import { defineTool } from "eve/tools";
import { z } from "zod";
import { sqlQuery } from "#lib/hexclave-client.ts";
import { readGrowthRunContext } from "#lib/run-context.ts";

// Root-agent data read. Project/branch scoping comes from the session's run
// context (see lib/run-context.ts), never from the model, so a confused model
// cannot query another tenant. The backend sandboxes the query and returns
// query errors as data (success: false), so a bad query is feedback to
// iterate on, not a crash.
//
// The table list in the description hand-mirrors GROWTH_AGENT_QUERYABLE_TABLES
// in the backend's src/lib/growth/metric-catalog.ts — this app cannot import
// backend code, so the mirror is deliberate; update both together.
//
// WHY THIS TAKES A LIST RATHER THAN ONE QUERY: the tool call itself is cheap
// (0.5-0.7s of ClickHouse time, measured), but every call costs a full model
// STEP — a whole response generated, then the entire conversation re-read on
// the next one. Step telemetry from the 2026-08-11 run put model time at 99%
// of each phase's wall clock (465s of a 469s phase) across 173 steps averaging
// ~2,000 generated tokens each, while ALL tool execution summed to 6-15s per
// phase. So N separate queries cost N model steps, and the queries themselves
// cost nothing. Batching independent lookups into one call is the cheapest
// available reduction in step count, which is the second of the only two
// levers that move total run time (the other being reasoning tokens; see
// lib/model.ts).
//
// Queries run SEQUENTIALLY and independently: one failing query returns its
// own `success: false` entry and the rest still execute, so a single typo does
// not discard a batch's worth of work and force the model to re-issue it.
const MAX_BATCHED_QUERIES = 10;

const singleQuerySchema = z.object({
  query: z.string().min(1).max(100_000),
  max_rows: z.number().int().min(1).max(200).optional(),
});

export default defineTool({
  description: `Run one or more read-only analytical SQL queries against the current project's ClickHouse analytics tables: events, users, contact_channels, teams, team_member_profiles, team_permissions, team_invitations, email_outboxes, project_permissions, notification_preferences, refresh_tokens, connected_accounts, growth_daily_metrics, growth_daily_ad_metrics. Run \`SHOW TABLES\` and \`DESCRIBE TABLE <name>\` first — the column comments document each column's semantics. Scoping to the project/branch is automatic; never filter on project_id or branch_id. Use this for numbers the get-metrics baselines cannot answer. Results are capped at max_rows (max 200), so always aggregate and LIMIT in SQL instead of pulling raw rows. When you aggregate, every column in the SELECT must be either wrapped in an aggregate function or repeated in GROUP BY — ClickHouse rejects the query otherwise (NOT_AN_AGGREGATE), and the fix is to add the column to GROUP BY or aggregate it (e.g. \`any(col)\`). Per-person identifying columns (primary_email, display_name, profile_image_url, contact_channels.value, recipient_email, and the client/server metadata blobs) are BLOCKED in results and will fail the query — you may filter and join on them freely, just never return them. Aggregate instead: \`SELECT domain(primary_email) AS signup_domain, count(*) FROM users GROUP BY signup_domain\`. IMPORTANT — BATCH YOUR QUERIES: pass up to ${MAX_BATCHED_QUERIES} queries in \`queries\` and you get all their results in one call. Every separate call costs a full model round trip, which is by far the slowest part of an analysis, while the queries themselves take well under a second. Send every question you already know you need together; only split when a query's SQL genuinely depends on the rows an earlier one returned. Returns \`{ results: [...] }\` in the same order you passed them, each entry being rows on success or { success: false, error } describing what to fix — one bad query does not stop the others.`,
  inputSchema: z.object({
    queries: z.array(singleQuerySchema).min(1).max(MAX_BATCHED_QUERIES),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContext(ctx);
    const results = [];
    for (const entry of input.queries) {
      results.push(await sqlQuery({
        project_id: context.project_id,
        branch_id: context.branch_id,
        query: entry.query,
        ...entry.max_rows === undefined ? {} : { max_rows: entry.max_rows },
      }));
    }
    return { results };
  },
});
