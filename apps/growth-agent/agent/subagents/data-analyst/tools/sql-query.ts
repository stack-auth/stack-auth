import { defineTool } from "eve/tools";
import { z } from "zod";
import { sqlQuery } from "#lib/hexclave-client.ts";

// Thin per-subagent wrapper around the shared backend client: declared
// subagents inherit no root tools, so each subagent re-exposes exactly the
// endpoints it needs. The backend scopes and sandboxes the query to the given
// project/branch and returns query errors as data (success: false), so a bad
// query is feedback to iterate on, not a crash.
//
// The table list in the description hand-mirrors GROWTH_AGENT_QUERYABLE_TABLES
// in the backend's src/lib/growth/metric-catalog.ts — this app cannot import
// backend code, so the mirror is deliberate; update both together.
//
// Batches like the root tool (agent/tools/sql-query.ts) and for the same
// measured reason: the query costs ~0.5s, the model step wrapped around it
// costs ~29s. This subagent is where that matters most — it is the heaviest
// SQL consumer in a run, so its step count is a direct term in the critical
// path. Keep the two tools' batching semantics identical; they differ only in
// that this one takes explicit project/branch (a subagent has no run context).
const MAX_BATCHED_QUERIES = 10;

const singleQuerySchema = z.object({
  query: z.string().min(1).max(100_000),
  max_rows: z.number().int().min(1).max(200).optional(),
});

export default defineTool({
  description: `Run one or more read-only analytical SQL queries against the project's ClickHouse analytics tables: events, users, contact_channels, teams, team_member_profiles, team_permissions, team_invitations, email_outboxes, project_permissions, notification_preferences, refresh_tokens, connected_accounts, growth_daily_metrics, growth_daily_ad_metrics. Run \`SHOW TABLES\` and \`DESCRIBE TABLE <name>\` first — the column comments document each column's semantics. Scoping to the project/branch is automatic; never filter on project_id or branch_id. Results are capped at max_rows (default backend-side, max 200), so always aggregate and LIMIT in SQL instead of pulling raw rows. When you aggregate, every column in the SELECT must be either wrapped in an aggregate function or repeated in GROUP BY — ClickHouse rejects the query otherwise (NOT_AN_AGGREGATE), and the fix is to add the column to GROUP BY or aggregate it (e.g. \`any(col)\`). Per-person identifying columns (primary_email, display_name, profile_image_url, contact_channels.value, recipient_email, and the client/server metadata blobs) are BLOCKED in results and will fail the query — you may filter and join on them freely, just never return them. Aggregate instead: \`SELECT domain(primary_email) AS signup_domain, count(*) FROM users GROUP BY signup_domain\`. IMPORTANT — BATCH YOUR QUERIES: pass up to ${MAX_BATCHED_QUERIES} queries in \`queries\` and you get all their results in one call. Every separate call costs a full model round trip, which is by far the slowest part of an analysis, while the queries themselves take well under a second. Send every question you already know you need together — schema probes, baselines, and breakdowns can all go in one batch; only split when a query's SQL genuinely depends on the rows an earlier one returned. Returns \`{ results: [...] }\` in the same order you passed them, each entry being rows on success or { success: false, error } describing what to fix — one bad query does not stop the others.`,
  inputSchema: z.object({
    project_id: z.string().min(1),
    branch_id: z.string().min(1),
    queries: z.array(singleQuerySchema).min(1).max(MAX_BATCHED_QUERIES),
  }),
  async execute(input) {
    const results = [];
    for (const entry of input.queries) {
      results.push(await sqlQuery({
        project_id: input.project_id,
        branch_id: input.branch_id,
        query: entry.query,
        ...entry.max_rows === undefined ? {} : { max_rows: entry.max_rows },
      }));
    }
    return { results };
  },
});
