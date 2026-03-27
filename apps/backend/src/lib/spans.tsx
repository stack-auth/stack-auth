import { stripLoneSurrogates } from "@/lib/analytics-validation";
import { getClickhouseAdminClient } from "./clickhouse";

export type SpanInsertRow = {
  span_type: string,
  span_id: string,
  trace_id: string | null,
  started_at: Date,
  ended_at: Date | null,
  parent_ids: string[],
  data: Record<string, unknown>,
  project_id: string,
  branch_id: string,
  user_id: string | null,
  team_id: string | null,
  refresh_token_id: string | null,
  session_replay_id: string | null,
  session_replay_segment_id: string | null,
  from_server: boolean,
};

export async function insertSpans(rows: SpanInsertRow[]): Promise<void> {
  if (rows.length === 0) return;

  const sanitizedRows = rows.map((row) => ({
    ...row,
    data: stripLoneSurrogates(row.data) as Record<string, unknown>,
  }));

  await getClickhouseAdminClient().insert({
    table: "analytics_internal.spans",
    values: sanitizedRows,
    format: "JSONEachRow",
    clickhouse_settings: {
      date_time_input_format: "best_effort",
      async_insert: 1,
    },
  });
}
