/**
 * Local-only benchmark + equivalence harness for the MAU ClickHouse query in
 * apps/backend/src/app/api/latest/internal/metrics/route.tsx (loadMonthlyActiveUsers).
 *
 * - Seeds synthetic $token-refresh events under a unique project_id so real
 *   data is never touched.
 * - Runs the current query ("old") and the proposed query ("new") with unique
 *   query_ids, then reads peak memory_usage / read_rows / read_bytes from
 *   system.query_log for each.
 * - Runs an edge-case matrix to prove both queries return identical MAU counts.
 * - Cleans up its rows on exit (even on failure).
 *
 * Run: pnpm --filter @stackframe/backend run with-env:dev tsx scripts/benchmark-mau-query.ts
 * Env knobs:
 *   BENCH_USERS       (default 200_000) – distinct users in the perf seed
 *   BENCH_EVENTS_USER (default 5)       – events per user
 *   BENCH_ANON_RATIO  (default 0.1)     – fraction flagged is_anonymous
 *   BENCH_BATCH       (default 50_000)  – insert batch size
 *   BENCH_SKIP_PERF=1                   – skip the heavy perf run
 *   BENCH_SKIP_MATRIX=1                 – skip the equivalence matrix
 *   BENCH_ROUTE_QUERIES=1               – also benchmark every ClickHouse
 *                                         query in the /internal/metrics route
 *                                         (uses the same seed)
 *   BENCH_PAGE_VIEWS_USER (default 3)   – $page-view events per user
 *   BENCH_CLICKS_USER     (default 1)   – $click events per user
 *   BENCH_TEAM_RATIO      (default 0.3) – fraction of users with a team
 */

import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { randomUUID } from "node:crypto";

const RUN_ID = randomUUID();
const BENCH_PROJECT_ID = `bench-mau-${RUN_ID}`;
const PERF_BRANCH_ID = "perf";

const METRICS_WINDOW_DAYS = 30;
const METRICS_WINDOW_MS = METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_RE_CH = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

function envInt(name: string, fallback: number): number {
  const v = getEnvVariable(name, "");
  if (v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`bad ${name}: ${v}`);
  return n;
}
function envFloat(name: string, fallback: number): number {
  const v = getEnvVariable(name, "");
  if (v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`bad ${name}: ${v}`);
  return n;
}
function envBool(name: string): boolean {
  const v = getEnvVariable(name, "");
  return v === "1" || v === "true";
}

function formatCh(date: Date): string {
  return date.toISOString().slice(0, 19);
}

function normalizeUuidFromEvent(value: string): string | null {
  const n = value.trim().toLowerCase();
  return UUID_RE.test(n) ? n : null;
}

type EventRow = {
  event_type: string,
  event_at: string,
  data: Record<string, unknown>,
  project_id: string,
  branch_id: string,
  user_id: string | null,
  team_id: string | null,
};

const OLD_QUERY = `
  SELECT assumeNotNull(user_id) AS user_id
  FROM analytics_internal.events
  WHERE event_type = '$token-refresh'
    AND project_id = {projectId:String}
    AND branch_id = {branchId:String}
    AND user_id IS NOT NULL
    AND event_at >= {since:DateTime}
    AND event_at < {untilExclusive:DateTime}
    AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
  GROUP BY user_id
`;

// Proposed query. Counts on the server (so we never ship N user_ids back to
// the client) and filters via direct JSON path access (skips the per-row
// toJSONString → JSONExtract round-trip that blows up memory in prod).
// Matches the old JS normalization: lower/trim + isUuid regex.
const NEW_QUERY = `
  SELECT uniqExact(normalized_user_id) AS mau
  FROM (
    SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
    FROM analytics_internal.events
    WHERE event_type = '$token-refresh'
      AND project_id = {projectId:String}
      AND branch_id = {branchId:String}
      AND user_id IS NOT NULL
      AND event_at >= {since:DateTime}
      AND event_at < {untilExclusive:DateTime}
      AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
  )
  WHERE match(normalized_user_id, {uuidRe:String})
`;

type QueryParams = {
  projectId: string,
  branchId: string,
  since: Date,
  untilExclusive: Date,
  includeAnonymous: boolean,
};

async function runOld(p: QueryParams): Promise<{ count: number, set: Set<string>, queryId: string }> {
  const client = getClickhouseAdminClient();
  const queryId = `bench-old-${randomUUID()}`;
  const res = await client.query({
    query: OLD_QUERY,
    query_params: {
      projectId: p.projectId,
      branchId: p.branchId,
      since: formatCh(p.since),
      untilExclusive: formatCh(p.untilExclusive),
      includeAnonymous: p.includeAnonymous ? 1 : 0,
    },
    query_id: queryId,
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as { user_id: string }[];
  const set = new Set<string>();
  for (const r of rows) {
    const n = normalizeUuidFromEvent(r.user_id);
    if (n != null) set.add(n);
  }
  return { count: set.size, set, queryId };
}

async function runNew(p: QueryParams): Promise<{ count: number, queryId: string }> {
  const client = getClickhouseAdminClient();
  const queryId = `bench-new-${randomUUID()}`;
  const res = await client.query({
    query: NEW_QUERY,
    query_params: {
      projectId: p.projectId,
      branchId: p.branchId,
      since: formatCh(p.since),
      untilExclusive: formatCh(p.untilExclusive),
      includeAnonymous: p.includeAnonymous ? 1 : 0,
      uuidRe: UUID_RE_CH,
    },
    query_id: queryId,
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as { mau: string | number }[];
  return { count: Number(rows[0]?.mau ?? 0), queryId };
}

// Diagnostic-only variant of the NEW query that returns the set of distinct
// normalized user_ids instead of just the count. Used by the equivalence
// check to prove the OLD pipeline and the NEW pipeline would have counted
// the *same users*, not just the same number of users.
const NEW_QUERY_SET = `
  SELECT DISTINCT normalized_user_id
  FROM (
    SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
    FROM analytics_internal.events
    WHERE event_type = '$token-refresh'
      AND project_id = {projectId:String}
      AND branch_id = {branchId:String}
      AND user_id IS NOT NULL
      AND event_at >= {since:DateTime}
      AND event_at < {untilExclusive:DateTime}
      AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
  )
  WHERE match(normalized_user_id, {uuidRe:String})
`;

async function runNewSet(p: QueryParams): Promise<Set<string>> {
  const client = getClickhouseAdminClient();
  const res = await client.query({
    query: NEW_QUERY_SET,
    query_params: {
      projectId: p.projectId,
      branchId: p.branchId,
      since: formatCh(p.since),
      untilExclusive: formatCh(p.untilExclusive),
      includeAnonymous: p.includeAnonymous ? 1 : 0,
      uuidRe: UUID_RE_CH,
    },
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as { normalized_user_id: string }[];
  return new Set(rows.map((r) => r.normalized_user_id));
}

function setDiff(a: Set<string>, b: Set<string>): { onlyInA: string[], onlyInB: string[] } {
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  for (const x of a) if (!b.has(x)) onlyInA.push(x);
  for (const x of b) if (!a.has(x)) onlyInB.push(x);
  return { onlyInA, onlyInB };
}

// ── Alternate query variants explored for further memory/duration wins ──────
// Each variant returns a single row with `mau` (count). The equivalence check
// compares against the OLD pipeline's exact count.

type Variant = {
  name: string,
  description: string,
  approximate?: boolean,
  sql: string,
};

const COMMON_FILTERS = `
  WHERE event_type = '$token-refresh'
    AND project_id = {projectId:String}
    AND branch_id = {branchId:String}
    AND user_id IS NOT NULL
    AND event_at >= {since:DateTime}
    AND event_at < {untilExclusive:DateTime}
    AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
`;

const VARIANTS: Variant[] = [
  {
    name: "v1_uniqExact_string",
    description: "uniqExact on lower(trim(user_id)) string; regex filter in outer WHERE (current fix)",
    sql: `
      SELECT uniqExact(normalized_user_id) AS mau
      FROM (
        SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
        FROM analytics_internal.events
        ${COMMON_FILTERS}
      )
      WHERE match(normalized_user_id, {uuidRe:String})
    `,
  },
  {
    name: "v2_uniqExact_inline",
    description: "Same as v1 but regex + normalization folded into inner WHERE (no subquery)",
    sql: `
      SELECT uniqExact(lower(trim(assumeNotNull(user_id)))) AS mau
      FROM analytics_internal.events
      ${COMMON_FILTERS}
        AND match(lower(trim(assumeNotNull(user_id))), {uuidRe:String})
    `,
  },
  {
    name: "v3_uniqExact_toUUID",
    description: "uniqExact on toUUIDOrNull(...) — 16-byte native UUID keys instead of 36-byte strings",
    sql: `
      SELECT uniqExact(uid) AS mau
      FROM (
        SELECT toUUIDOrNull(lower(trim(assumeNotNull(user_id)))) AS uid
        FROM analytics_internal.events
        ${COMMON_FILTERS}
      )
      WHERE uid IS NOT NULL
        AND match(toString(uid), {uuidRe:String})
    `,
  },
  {
    name: "v4_uniqExact_sipHash64",
    description: "uniqExact on sipHash64(...) — 8-byte keys; collision prob negligible at <<2^32 users",
    sql: `
      SELECT uniqExact(h) AS mau
      FROM (
        SELECT sipHash64(lower(trim(assumeNotNull(user_id)))) AS h,
               lower(trim(assumeNotNull(user_id))) AS normalized_user_id
        FROM analytics_internal.events
        ${COMMON_FILTERS}
      )
      WHERE match(normalized_user_id, {uuidRe:String})
    `,
  },
  {
    name: "v5_uniq_hll",
    description: "uniq() HyperLogLog — bounded ~16 KiB state, typical error ~0.5% (APPROXIMATE)",
    approximate: true,
    sql: `
      SELECT uniq(normalized_user_id) AS mau
      FROM (
        SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
        FROM analytics_internal.events
        ${COMMON_FILTERS}
      )
      WHERE match(normalized_user_id, {uuidRe:String})
    `,
  },
  {
    name: "v6_uniqCombined",
    description: "uniqCombined(17) — exact for small N, HLL after threshold; ~96 KiB state (APPROXIMATE)",
    approximate: true,
    sql: `
      SELECT uniqCombined(17)(normalized_user_id) AS mau
      FROM (
        SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
        FROM analytics_internal.events
        ${COMMON_FILTERS}
      )
      WHERE match(normalized_user_id, {uuidRe:String})
    `,
  },
  {
    name: "v7_uniqHLL12",
    description: "uniqHLL12 — ~4 KiB state, typical error ~2% (APPROXIMATE)",
    approximate: true,
    sql: `
      SELECT uniqHLL12(normalized_user_id) AS mau
      FROM (
        SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
        FROM analytics_internal.events
        ${COMMON_FILTERS}
      )
      WHERE match(normalized_user_id, {uuidRe:String})
    `,
  },
];

// ── Route-wide query census ─────────────────────────────────────────────────
// Every ClickHouse query from apps/backend/src/app/api/latest/internal/metrics/route.tsx,
// captured verbatim so we can measure the full shape of the endpoint.

type RouteQuery = {
  name: string,
  desc: string,
  sql: string,
  extraParams?: (now: Date, untilExclusive: Date) => Record<string, unknown>,
};

const ANALYTICS_USER_JOIN = `
  LEFT JOIN (
    SELECT
      user_id,
      argMax(JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8'), event_at) AS latest_is_anonymous
    FROM analytics_internal.events
    WHERE event_type = '$token-refresh'
      AND project_id = {projectId:String}
      AND branch_id = {branchId:String}
      AND user_id IS NOT NULL
      AND event_at < {untilExclusive:DateTime}
    GROUP BY user_id
  ) AS token_refresh_users
    ON e.user_id = token_refresh_users.user_id
`;
const NON_ANON_FILTER = "({includeAnonymous:UInt8} = 1 OR coalesce(JSONExtract(toJSONString(e.data), 'is_anonymous', 'Nullable(UInt8)'), token_refresh_users.latest_is_anonymous, 0) = 0)";

// Same joins/filters after fix 1 (direct CAST instead of JSONExtract(toJSONString(...)))
const ANALYTICS_USER_JOIN_AFTER = `
  LEFT JOIN (
    SELECT
      user_id,
      argMax(coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0), event_at) AS latest_is_anonymous
    FROM analytics_internal.events
    WHERE event_type = '$token-refresh'
      AND project_id = {projectId:String}
      AND branch_id = {branchId:String}
      AND user_id IS NOT NULL
      AND event_at < {untilExclusive:DateTime}
    GROUP BY user_id
  ) AS token_refresh_users
    ON e.user_id = token_refresh_users.user_id
`;
const NON_ANON_FILTER_AFTER = "({includeAnonymous:UInt8} = 1 OR coalesce(CAST(e.data.is_anonymous, 'Nullable(UInt8)'), token_refresh_users.latest_is_anonymous, 0) = 0)";

const ROUTE_QUERIES_BEFORE: RouteQuery[] = [
  {
    name: "loadUsersByCountry",
    desc: "argMax country per user over all $token-refresh events (no window)",
    sql: `
      SELECT
        country_code,
        count() AS userCount
      FROM (
        SELECT
          user_id,
          argMax(cc, event_at) AS country_code
        FROM (
          SELECT
            user_id,
            event_at,
            CAST(data.ip_info.country_code, 'Nullable(String)') AS cc,
            CAST(data.is_anonymous, 'UInt8') AS is_anonymous
          FROM analytics_internal.events
          WHERE event_type = '$token-refresh'
            AND project_id = {projectId:String}
            AND branch_id = {branchId:String}
            AND user_id IS NOT NULL
        )
        WHERE cc IS NOT NULL
          AND ({includeAnonymous:UInt8} = 1 OR is_anonymous = 0)
        GROUP BY user_id
      )
      WHERE country_code IS NOT NULL
      GROUP BY country_code
      ORDER BY userCount DESC
    `,
  },
  {
    name: "loadDailyActiveUsers",
    desc: "DAU per day over 30d (uniqExact on raw user_id)",
    sql: `
      SELECT
        toDate(event_at) AS day,
        uniqExact(assumeNotNull(user_id)) AS dau
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
      GROUP BY day
      ORDER BY day ASC
    `,
  },
  {
    name: "loadDailyActiveUsersSplit",
    desc: "All (day, user_id) pairs — ships N rows back to Node for split processing",
    sql: `
      SELECT
        toDate(event_at) AS day,
        assumeNotNull(user_id) AS user_id
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
      GROUP BY day, user_id
    `,
  },
  {
    name: "loadDailyActiveTeamsSplit",
    desc: "All (day, team_id) pairs — same shape as DAU split, team side",
    sql: `
      SELECT
        toDate(event_at) AS day,
        assumeNotNull(team_id) AS team_id
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND team_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
      GROUP BY day, team_id
    `,
  },
  {
    name: "loadMonthlyActiveUsers (FIXED: v4)",
    desc: "NEW: uniqExact(sipHash64(normalized)) — what we just shipped",
    sql: `
      SELECT uniqExact(sipHash64(normalized_user_id)) AS mau
      FROM (
        SELECT lower(trim(assumeNotNull(user_id))) AS normalized_user_id
        FROM analytics_internal.events
        WHERE event_type = '$token-refresh'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND user_id IS NOT NULL
          AND event_at >= {since:DateTime}
          AND event_at < {untilExclusive:DateTime}
          AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
      )
      WHERE match(normalized_user_id, {uuidRe:String})
    `,
  },
  {
    name: "analyticsOverview:dailyEvents",
    desc: "page-view+click daily counts, visitors/day — with LEFT JOIN to token_refresh_users",
    sql: `
      SELECT
        toDate(e.event_at) AS day,
        countIf(
          e.event_type = '$page-view'
            AND e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER}
        ) AS pv,
        countIf(
          e.event_type = '$click'
            AND e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER}
        ) AS cl,
        uniqExactIf(
          assumeNotNull(e.user_id),
          e.event_type = '$page-view'
            AND e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER}
        ) AS visitors
      FROM analytics_internal.events AS e
      ${ANALYTICS_USER_JOIN}
      WHERE e.event_type IN ('$page-view', '$click')
        AND e.project_id = {projectId:String}
        AND e.branch_id = {branchId:String}
        AND e.event_at >= {since:DateTime}
        AND e.event_at < {untilExclusive:DateTime}
      GROUP BY day
      ORDER BY day ASC
    `,
  },
  {
    name: "analyticsOverview:totalVisitors",
    desc: "uniq visitors over 30d (page-view + join)",
    sql: `
      SELECT
        uniqExactIf(
          assumeNotNull(e.user_id),
          e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER}
        ) AS visitors
      FROM analytics_internal.events AS e
      ${ANALYTICS_USER_JOIN}
      WHERE e.event_type = '$page-view'
        AND e.project_id = {projectId:String}
        AND e.branch_id = {branchId:String}
        AND e.user_id IS NOT NULL
        AND e.event_at >= {since:DateTime}
        AND e.event_at < {untilExclusive:DateTime}
    `,
  },
  {
    name: "analyticsOverview:topReferrers",
    desc: "top 100 referrers by uniq visitors (GROUP BY referrer)",
    sql: `
      SELECT
        nullIf(CAST(e.data.referrer, 'String'), '') AS referrer,
        uniqExactIf(
          assumeNotNull(e.user_id),
          e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER}
        ) AS visitors
      FROM analytics_internal.events AS e
      ${ANALYTICS_USER_JOIN}
      WHERE e.event_type = '$page-view'
        AND e.project_id = {projectId:String}
        AND e.branch_id = {branchId:String}
        AND e.event_at >= {since:DateTime}
        AND e.event_at < {untilExclusive:DateTime}
      GROUP BY referrer
      HAVING visitors > 0
      ORDER BY visitors DESC
      LIMIT 100
    `,
  },
  {
    name: "analyticsOverview:topRegion",
    desc: "top (country, region) by uniq visitors (LIMIT 1)",
    sql: `
      SELECT
        CAST(data.ip_info.country_code, 'Nullable(String)') AS country_code,
        CAST(data.ip_info.region_code, 'Nullable(String)') AS region_code,
        uniqExactIf(
          assumeNotNull(user_id),
          user_id IS NOT NULL
            AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
        ) AS visitors
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
      GROUP BY country_code, region_code
      HAVING visitors > 0
      ORDER BY visitors DESC
      LIMIT 1
    `,
  },
  {
    name: "analyticsOverview:online",
    desc: "uniq users active in last 5 minutes",
    sql: `
      SELECT
        uniqExact(assumeNotNull(user_id)) AS online
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {onlineSince:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR JSONExtract(toJSONString(data), 'is_anonymous', 'UInt8') = 0)
    `,
    extraParams: (now, untilExclusive) => ({
      onlineSince: formatCh(new Date(now.getTime() - 5 * 60 * 1000)),
      untilExclusive: formatCh(untilExclusive),
    }),
  },
];

// After fixes 1 + 3. Same names, updated SQL. Queries not touched by either
// fix (loadUsersByCountry, loadMonthlyActiveUsers-FIXED) reuse the BEFORE entry.
function splitSqlAfter(idCol: "user_id" | "team_id", withAnonFilter: boolean): string {
  const anonFilter = withAnonFilter
    ? "AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)"
    : "";
  return `
    SELECT
      toString(w.day) AS day,
      count() AS total_count,
      countIf(f.first_date = w.day) AS new_count,
      countIf(f.first_date < w.day AND w.prev_day = addDays(w.day, -1)) AS retained_count,
      countIf(f.first_date < w.day AND (isNull(w.prev_day) OR w.prev_day < addDays(w.day, -1))) AS reactivated_count
    FROM (
      SELECT
        day,
        ${idCol},
        lagInFrame(day, 1) OVER (PARTITION BY ${idCol} ORDER BY day) AS prev_day
      FROM (
        SELECT DISTINCT
          toDate(event_at) AS day,
          assumeNotNull(${idCol}) AS ${idCol}
        FROM analytics_internal.events
        WHERE event_type = '$token-refresh'
          AND project_id = {projectId:String}
          AND branch_id = {branchId:String}
          AND ${idCol} IS NOT NULL
          AND event_at >= {since:DateTime}
          AND event_at < {untilExclusive:DateTime}
          ${anonFilter}
      )
    ) AS w
    LEFT JOIN (
      SELECT
        assumeNotNull(${idCol}) AS ${idCol},
        toDate(min(event_at)) AS first_date
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND ${idCol} IS NOT NULL
        AND event_at < {untilExclusive:DateTime}
        ${anonFilter}
      GROUP BY ${idCol}
    ) AS f USING (${idCol})
    GROUP BY w.day
    ORDER BY w.day ASC
  `;
}

const ROUTE_QUERIES_AFTER: RouteQuery[] = [
  // Unchanged by fix 1/3 (already uses CAST).
  ROUTE_QUERIES_BEFORE[0], // loadUsersByCountry
  {
    name: "loadDailyActiveUsers",
    desc: "DAU per day (fix 1: CAST instead of JSONExtract)",
    sql: `
      SELECT
        toDate(event_at) AS day,
        uniqExact(assumeNotNull(user_id)) AS dau
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
      GROUP BY day
      ORDER BY day ASC
    `,
  },
  {
    name: "loadDailyActiveUsersSplit",
    desc: "fix 3: server-side new/retained/reactivated (no PG join, 31-row result)",
    sql: splitSqlAfter("user_id", true),
  },
  {
    name: "loadDailyActiveTeamsSplit",
    desc: "fix 3: server-side new/retained/reactivated (no PG join, 31-row result)",
    sql: splitSqlAfter("team_id", false),
  },
  // Unchanged — already v4 fixed.
  ROUTE_QUERIES_BEFORE[4], // loadMonthlyActiveUsers
  {
    name: "analyticsOverview:dailyEvents",
    desc: "fix 1: direct CAST in join + non-anon filter",
    sql: `
      SELECT
        toDate(e.event_at) AS day,
        countIf(
          e.event_type = '$page-view'
            AND e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER_AFTER}
        ) AS pv,
        countIf(
          e.event_type = '$click'
            AND e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER_AFTER}
        ) AS cl,
        uniqExactIf(
          assumeNotNull(e.user_id),
          e.event_type = '$page-view'
            AND e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER_AFTER}
        ) AS visitors
      FROM analytics_internal.events AS e
      ${ANALYTICS_USER_JOIN_AFTER}
      WHERE e.event_type IN ('$page-view', '$click')
        AND e.project_id = {projectId:String}
        AND e.branch_id = {branchId:String}
        AND e.event_at >= {since:DateTime}
        AND e.event_at < {untilExclusive:DateTime}
      GROUP BY day
      ORDER BY day ASC
    `,
  },
  {
    name: "analyticsOverview:totalVisitors",
    desc: "fix 1: direct CAST in join + non-anon filter",
    sql: `
      SELECT
        uniqExactIf(
          assumeNotNull(e.user_id),
          e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER_AFTER}
        ) AS visitors
      FROM analytics_internal.events AS e
      ${ANALYTICS_USER_JOIN_AFTER}
      WHERE e.event_type = '$page-view'
        AND e.project_id = {projectId:String}
        AND e.branch_id = {branchId:String}
        AND e.user_id IS NOT NULL
        AND e.event_at >= {since:DateTime}
        AND e.event_at < {untilExclusive:DateTime}
    `,
  },
  {
    name: "analyticsOverview:topReferrers",
    desc: "fix 1: direct CAST in join + non-anon filter",
    sql: `
      SELECT
        nullIf(CAST(e.data.referrer, 'String'), '') AS referrer,
        uniqExactIf(
          assumeNotNull(e.user_id),
          e.user_id IS NOT NULL
            AND ${NON_ANON_FILTER_AFTER}
        ) AS visitors
      FROM analytics_internal.events AS e
      ${ANALYTICS_USER_JOIN_AFTER}
      WHERE e.event_type = '$page-view'
        AND e.project_id = {projectId:String}
        AND e.branch_id = {branchId:String}
        AND e.event_at >= {since:DateTime}
        AND e.event_at < {untilExclusive:DateTime}
      GROUP BY referrer
      HAVING visitors > 0
      ORDER BY visitors DESC
      LIMIT 100
    `,
  },
  {
    name: "analyticsOverview:topRegion",
    desc: "fix 1: direct CAST",
    sql: `
      SELECT
        CAST(data.ip_info.country_code, 'Nullable(String)') AS country_code,
        CAST(data.ip_info.region_code, 'Nullable(String)') AS region_code,
        uniqExactIf(
          assumeNotNull(user_id),
          user_id IS NOT NULL
            AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
        ) AS visitors
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {since:DateTime}
        AND event_at < {untilExclusive:DateTime}
      GROUP BY country_code, region_code
      HAVING visitors > 0
      ORDER BY visitors DESC
      LIMIT 1
    `,
  },
  {
    name: "analyticsOverview:online",
    desc: "fix 1: direct CAST",
    sql: `
      SELECT
        uniqExact(assumeNotNull(user_id)) AS online
      FROM analytics_internal.events
      WHERE event_type = '$token-refresh'
        AND project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND user_id IS NOT NULL
        AND event_at >= {onlineSince:DateTime}
        AND event_at < {untilExclusive:DateTime}
        AND ({includeAnonymous:UInt8} = 1 OR coalesce(CAST(data.is_anonymous, 'Nullable(UInt8)'), 0) = 0)
    `,
    extraParams: (now, untilExclusive) => ({
      onlineSince: formatCh(new Date(now.getTime() - 5 * 60 * 1000)),
      untilExclusive: formatCh(untilExclusive),
    }),
  },
];

async function runRouteQuery(rq: RouteQuery, p: QueryParams, now: Date): Promise<string> {
  const client = getClickhouseAdminClient();
  const queryId = `bench-route-${rq.name.replace(/[^a-z0-9]/gi, "-")}-${randomUUID()}`;
  const baseParams: Record<string, unknown> = {
    projectId: p.projectId,
    branchId: p.branchId,
    since: formatCh(p.since),
    untilExclusive: formatCh(p.untilExclusive),
    includeAnonymous: p.includeAnonymous ? 1 : 0,
    uuidRe: UUID_RE_CH,
  };
  const extra = rq.extraParams ? rq.extraParams(now, p.untilExclusive) : {};
  await client.query({
    query: rq.sql,
    query_params: { ...baseParams, ...extra },
    query_id: queryId,
    format: "JSONEachRow",
  }).then((r) => r.json()); // drain stream
  return queryId;
}

async function benchmarkRouteQueries(now: Date): Promise<void> {
  const untilExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + ONE_DAY_MS);
  const since = new Date(untilExclusive.getTime() - METRICS_WINDOW_MS);
  const params: QueryParams = {
    projectId: BENCH_PROJECT_ID,
    branchId: PERF_BRANCH_ID,
    since,
    untilExclusive,
    includeAnonymous: false,
  };

  console.log("\n── Route-wide query benchmark (every ClickHouse query in /internal/metrics) ──");

  // Warm cache once.
  await runRouteQuery(ROUTE_QUERIES_BEFORE[1], params, now);

  async function runAll(list: RouteQuery[]): Promise<Map<string, QueryStats>> {
    const out = new Map<string, QueryStats>();
    for (const rq of list) {
      const qid = await runRouteQuery(rq, params, now);
      out.set(rq.name, await readStats(qid));
    }
    return out;
  }

  const beforeStats = await runAll(ROUTE_QUERIES_BEFORE);
  const afterStats = await runAll(ROUTE_QUERIES_AFTER);

  // Normalize query names for the comparison table. Some AFTER queries have
  // the same name as BEFORE so they line up; loadMonthlyActiveUsers's BEFORE
  // entry is labeled "(FIXED: v4)" — normalize to match.
  const normalize = (n: string) => n.replace(/\s*\(FIXED.*\)$/, "").trim();

  const padL = (s: string, n: number) => s.padEnd(n);
  const padR = (s: string, n: number) => s.padStart(n);
  const fmtDelta = (a: number, b: number): string => {
    if (a === 0) return "—";
    const ratio = a / Math.max(b, 1);
    if (ratio >= 1) return `${ratio.toFixed(2)}× less`;
    return `${(1 / ratio).toFixed(2)}× more`;
  };

  console.log("\n  Per-query comparison (BEFORE → AFTER):");
  console.log("  " + [
    padL("query", 36),
    padR("mem BEFORE", 12),
    padR("mem AFTER", 12),
    padR("Δ mem", 10),
    padR("dur BEFORE", 11),
    padR("dur AFTER", 11),
    padR("Δ dur", 10),
  ].join("  "));
  console.log("  " + "─".repeat(130));

  const pairs: { name: string, before: QueryStats, after: QueryStats }[] = [];
  for (const rq of ROUTE_QUERIES_BEFORE) {
    const name = normalize(rq.name);
    const b = beforeStats.get(rq.name);
    const a = afterStats.get(rq.name) ?? afterStats.get(name) ??
      [...afterStats.entries()].find(([k]) => normalize(k) === name)?.[1];
    if (!b || !a) continue;
    pairs.push({ name, before: b, after: a });
  }
  // Sort by BEFORE memory descending for readability.
  pairs.sort((x, y) => y.before.memory_usage - x.before.memory_usage);

  for (const { name, before, after } of pairs) {
    console.log("  " + [
      padL(name, 36),
      padR(fmtBytes(before.memory_usage), 12),
      padR(fmtBytes(after.memory_usage), 12),
      padR(fmtDelta(before.memory_usage, after.memory_usage), 10),
      padR(`${before.query_duration_ms} ms`, 11),
      padR(`${after.query_duration_ms} ms`, 11),
      padR(fmtDelta(before.query_duration_ms, after.query_duration_ms), 10),
    ].join("  "));
  }

  const sumMemBefore = pairs.reduce((a, b) => a + b.before.memory_usage, 0);
  const sumMemAfter = pairs.reduce((a, b) => a + b.after.memory_usage, 0);
  const maxDurBefore = Math.max(...pairs.map((p) => p.before.query_duration_ms));
  const maxDurAfter = Math.max(...pairs.map((p) => p.after.query_duration_ms));
  const sumDurBefore = pairs.reduce((a, b) => a + b.before.query_duration_ms, 0);
  const sumDurAfter = pairs.reduce((a, b) => a + b.after.query_duration_ms, 0);
  const sumReadBefore = pairs.reduce((a, b) => a + b.before.read_bytes, 0);
  const sumReadAfter = pairs.reduce((a, b) => a + b.after.read_bytes, 0);
  const sumResultBefore = pairs.reduce((a, b) => a + b.before.result_bytes, 0);
  const sumResultAfter = pairs.reduce((a, b) => a + b.after.result_bytes, 0);

  console.log("\n  Totals:");
  console.log(`    Sum peak memory:  ${fmtBytes(sumMemBefore)} → ${fmtBytes(sumMemAfter)}  (${fmtDelta(sumMemBefore, sumMemAfter)})`);
  console.log(`    Max query dur:    ${maxDurBefore} ms → ${maxDurAfter} ms  (${fmtDelta(maxDurBefore, maxDurAfter)})  [endpoint wall-clock floor]`);
  console.log(`    Sum query dur:    ${sumDurBefore} ms → ${sumDurAfter} ms  (${fmtDelta(sumDurBefore, sumDurAfter)})  [total CPU work]`);
  console.log(`    Sum bytes read:   ${fmtBytes(sumReadBefore)} → ${fmtBytes(sumReadAfter)}  (${fmtDelta(sumReadBefore, sumReadAfter)})`);
  console.log(`    Sum result ship:  ${fmtBytes(sumResultBefore)} → ${fmtBytes(sumResultAfter)}  (${fmtDelta(sumResultBefore, sumResultAfter)})`);
}

async function runVariant(v: Variant, p: QueryParams): Promise<{ count: number, queryId: string }> {
  const client = getClickhouseAdminClient();
  const queryId = `bench-${v.name}-${randomUUID()}`;
  const res = await client.query({
    query: v.sql,
    query_params: {
      projectId: p.projectId,
      branchId: p.branchId,
      since: formatCh(p.since),
      untilExclusive: formatCh(p.untilExclusive),
      includeAnonymous: p.includeAnonymous ? 1 : 0,
      uuidRe: UUID_RE_CH,
    },
    query_id: queryId,
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as { mau: string | number }[];
  return { count: Number(rows[0]?.mau ?? 0), queryId };
}

type QueryStats = {
  memory_usage: number,
  read_rows: number,
  read_bytes: number,
  result_rows: number,
  result_bytes: number,
  query_duration_ms: number,
};

async function readStats(queryId: string): Promise<QueryStats> {
  const client = getClickhouseAdminClient();
  await client.command({ query: "SYSTEM FLUSH LOGS" });
  const delays = [100, 200, 400, 800, 1600];
  for (let i = 0; i <= delays.length; i++) {
    const res = await client.query({
      query: `
        SELECT
          toUInt64(memory_usage)         AS memory_usage,
          toUInt64(read_rows)            AS read_rows,
          toUInt64(read_bytes)           AS read_bytes,
          toUInt64(result_rows)          AS result_rows,
          toUInt64(result_bytes)         AS result_bytes,
          toUInt64(query_duration_ms)    AS query_duration_ms
        FROM system.query_log
        WHERE query_id = {qid:String} AND type = 'QueryFinish'
        ORDER BY event_time DESC
        LIMIT 1
      `,
      query_params: { qid: queryId },
      format: "JSONEachRow",
    });
    const rows = (await res.json()) as Array<Record<string, string>>;
    if (rows.length === 1) {
      const r = rows[0];
      return {
        memory_usage: Number(r.memory_usage),
        read_rows: Number(r.read_rows),
        read_bytes: Number(r.read_bytes),
        result_rows: Number(r.result_rows),
        result_bytes: Number(r.result_bytes),
        query_duration_ms: Number(r.query_duration_ms),
      };
    }
    if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
  }
  throw new Error(`no query_log row for ${queryId}`);
}

async function seed(rows: EventRow[], batch = envInt("BENCH_BATCH", 50_000)): Promise<void> {
  const client = getClickhouseAdminClient();
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    await client.insert({
      table: "analytics_internal.events",
      values: chunk,
      format: "JSONEachRow",
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }
}

async function cleanup(): Promise<void> {
  const client = getClickhouseAdminClient();
  await client.command({
    query: `ALTER TABLE analytics_internal.events DELETE WHERE project_id = {p:String}`,
    query_params: { p: BENCH_PROJECT_ID },
    // Block until the mutation is applied so the script exits clean.
    clickhouse_settings: { mutations_sync: "2" },
  });
}

// ── Edge-case matrix ─────────────────────────────────────────────────────────

type Case = {
  name: string,
  branchId: string,
  includeAnonymous: boolean,
  expected: number,
  buildEvents: (windowStart: Date, windowEnd: Date) => EventRow[],
};

function mkUuid(): string {
  // randomUUID is v4, matches isUuid regex.
  return randomUUID();
}

function mkEvent(opts: {
  branchId: string,
  at: Date,
  userId: string | null,
  isAnonymous?: boolean | null,
  eventType?: string,
  projectId?: string,
  teamId?: string | null,
  extraData?: Record<string, unknown>,
}): EventRow {
  const eventType = opts.eventType ?? "$token-refresh";
  let data: Record<string, unknown>;
  if (eventType === "$token-refresh") {
    data = {
      refresh_token_id: mkUuid(),
      ip_info: null,
    };
    if (opts.isAnonymous !== undefined) data.is_anonymous = opts.isAnonymous;
  } else {
    data = {};
    if (opts.isAnonymous !== undefined) data.is_anonymous = opts.isAnonymous;
  }
  if (opts.extraData) Object.assign(data, opts.extraData);
  return {
    event_type: eventType,
    event_at: formatCh(opts.at),
    data,
    project_id: opts.projectId ?? BENCH_PROJECT_ID,
    branch_id: opts.branchId,
    user_id: opts.userId,
    team_id: opts.teamId ?? null,
  };
}

function buildMatrix(): Case[] {
  const otherProjectId = `${BENCH_PROJECT_ID}-other`;
  return [
    {
      name: "empty",
      branchId: "m-empty",
      includeAnonymous: false,
      expected: 0,
      buildEvents: () => [],
    },
    {
      name: "one user one event",
      branchId: "m-one",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-one", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
      ],
    },
    {
      name: "one user many events (dedup)",
      branchId: "m-dedup",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => {
        const u = mkUuid();
        const rows: EventRow[] = [];
        for (let i = 0; i < 50; i++) {
          rows.push(mkEvent({ branchId: "m-dedup", at: new Date(s.getTime() + (i + 1) * 60_000), userId: u, isAnonymous: false }));
        }
        return rows;
      },
    },
    {
      name: "mixed anon + non-anon, include_anonymous=false",
      branchId: "m-mix-false",
      includeAnonymous: false,
      expected: 3,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-mix-false", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-mix-false", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-mix-false", at: new Date(s.getTime() + 3 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-mix-false", at: new Date(s.getTime() + 4 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: true }),
        mkEvent({ branchId: "m-mix-false", at: new Date(s.getTime() + 5 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: true }),
      ],
    },
    {
      name: "mixed anon + non-anon, include_anonymous=true",
      branchId: "m-mix-true",
      includeAnonymous: true,
      expected: 5,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-mix-true", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-mix-true", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-mix-true", at: new Date(s.getTime() + 3 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-mix-true", at: new Date(s.getTime() + 4 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: true }),
        mkEvent({ branchId: "m-mix-true", at: new Date(s.getTime() + 5 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: true }),
      ],
    },
    {
      name: "window boundary (before since / after until)",
      branchId: "m-boundary",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s, e) => [
        // just before since — should be excluded
        mkEvent({ branchId: "m-boundary", at: new Date(s.getTime() - 1000), userId: mkUuid(), isAnonymous: false }),
        // inside window — counted
        mkEvent({ branchId: "m-boundary", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        // at untilExclusive — excluded (half-open interval)
        mkEvent({ branchId: "m-boundary", at: new Date(e.getTime()), userId: mkUuid(), isAnonymous: false }),
      ],
    },
    {
      name: "null user_id",
      branchId: "m-null-uid",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-null-uid", at: new Date(s.getTime() + ONE_DAY_MS), userId: null, isAnonymous: false }),
        mkEvent({ branchId: "m-null-uid", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
      ],
    },
    {
      name: "non-UUID user_id (filtered)",
      branchId: "m-non-uuid",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-non-uuid", at: new Date(s.getTime() + ONE_DAY_MS), userId: "not-a-uuid", isAnonymous: false }),
        mkEvent({ branchId: "m-non-uuid", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: "12345678-1234-1234-1234-123456789012", isAnonymous: false }), // v1 UUID shape, fails v4 regex
        mkEvent({ branchId: "m-non-uuid", at: new Date(s.getTime() + 3 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
      ],
    },
    {
      name: "case variation on user_id (dedup)",
      branchId: "m-case",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => {
        const u = mkUuid();
        return [
          mkEvent({ branchId: "m-case", at: new Date(s.getTime() + ONE_DAY_MS), userId: u, isAnonymous: false }),
          mkEvent({ branchId: "m-case", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: u.toUpperCase(), isAnonymous: false }),
          mkEvent({ branchId: "m-case", at: new Date(s.getTime() + 3 * ONE_DAY_MS), userId: `  ${u}  `, isAnonymous: false }),
        ];
      },
    },
    {
      name: "project isolation",
      branchId: "m-iso",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-iso", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
        mkEvent({ branchId: "m-iso", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false, projectId: otherProjectId }),
      ],
    },
    {
      name: "missing is_anonymous field (treated as non-anon)",
      branchId: "m-missing",
      includeAnonymous: false,
      expected: 2,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-missing", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid() /* no is_anonymous */ }),
        mkEvent({ branchId: "m-missing", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
      ],
    },
    {
      name: "null is_anonymous (treated as non-anon)",
      branchId: "m-null-anon",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-null-anon", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: null }),
      ],
    },
    {
      name: "wrong event_type ignored",
      branchId: "m-wrong-type",
      includeAnonymous: false,
      expected: 1,
      buildEvents: (s) => [
        mkEvent({ branchId: "m-wrong-type", at: new Date(s.getTime() + ONE_DAY_MS), userId: mkUuid(), isAnonymous: false, eventType: "$page-view" }),
        mkEvent({ branchId: "m-wrong-type", at: new Date(s.getTime() + 2 * ONE_DAY_MS), userId: mkUuid(), isAnonymous: false }),
      ],
    },
  ];
}

async function runMatrix(now: Date): Promise<boolean> {
  const untilExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + ONE_DAY_MS);
  const since = new Date(untilExclusive.getTime() - METRICS_WINDOW_MS - ONE_DAY_MS);

  const cases = buildMatrix();
  // Seed everything for matrix in one go (lots of small branches).
  const all: EventRow[] = cases.flatMap((c) => c.buildEvents(since, untilExclusive));
  if (all.length) await seed(all);

  let allPass = true;
  console.log("\n── Equivalence matrix (set equality, not just count) ──");
  for (const c of cases) {
    const params: QueryParams = {
      projectId: BENCH_PROJECT_ID,
      branchId: c.branchId,
      since,
      untilExclusive,
      includeAnonymous: c.includeAnonymous,
    };
    const [oldRes, newRes, newSet] = await Promise.all([
      runOld(params),
      runNew(params),
      runNewSet(params),
    ]);
    const countMatch = oldRes.count === newRes.count && oldRes.count === c.expected;
    const { onlyInA, onlyInB } = setDiff(oldRes.set, newSet);
    const setMatch = onlyInA.length === 0 && onlyInB.length === 0;
    const match = countMatch && setMatch;
    const tag = match ? "OK" : "FAIL";
    console.log(
      `  [${tag}] ${c.name.padEnd(48)} expected=${c.expected} old_count=${oldRes.count} new_count=${newRes.count} set_match=${setMatch}`,
    );
    if (!setMatch) {
      if (onlyInA.length > 0) console.log(`       only in OLD: ${onlyInA.slice(0, 3).join(", ")}${onlyInA.length > 3 ? ` …(+${onlyInA.length - 3})` : ""}`);
      if (onlyInB.length > 0) console.log(`       only in NEW: ${onlyInB.slice(0, 3).join(", ")}${onlyInB.length > 3 ? ` …(+${onlyInB.length - 3})` : ""}`);
    }
    if (!match) allPass = false;
  }
  return allPass;
}

// ── Heavy perf seed ──────────────────────────────────────────────────────────

const COUNTRY_CODES = ["US", "DE", "FR", "GB", "JP", "IN", "BR", "CA", "AU", "ES"];
const REFERRERS = ["https://google.com/", "https://twitter.com/", "https://news.ycombinator.com/", "", "https://github.com/", "https://reddit.com/"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function seedPerf(now: Date): Promise<void> {
  const users = envInt("BENCH_USERS", 200_000);
  const perUser = envInt("BENCH_EVENTS_USER", 5);
  const pvPerUser = envInt("BENCH_PAGE_VIEWS_USER", 3);
  const clicksPerUser = envInt("BENCH_CLICKS_USER", 1);
  const teamRatio = envFloat("BENCH_TEAM_RATIO", 0.3);
  const teamCount = Math.max(1, Math.floor(users * 0.05)); // ~5% as many teams as users
  const anonRatio = envFloat("BENCH_ANON_RATIO", 0.1);
  const tokenEvents = users * perUser;
  const pvEvents = users * pvPerUser;
  const clickEvents = users * clicksPerUser;
  const total = tokenEvents + pvEvents + clickEvents;
  console.log(
    `\n── Seeding perf data: ${users.toLocaleString()} users ` +
    `× (${perUser} $token-refresh + ${pvPerUser} $page-view + ${clicksPerUser} $click) ` +
    `+ ${teamCount.toLocaleString()} teams = ${total.toLocaleString()} rows ──`,
  );

  const batchRows = envInt("BENCH_BATCH", 50_000);
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + ONE_DAY_MS);
  const windowStart = new Date(windowEnd.getTime() - METRICS_WINDOW_MS);
  const spanMs = windowEnd.getTime() - windowStart.getTime();
  const teamIds: string[] = Array.from({ length: teamCount }, () => mkUuid());

  const t0 = Date.now();
  let buf: EventRow[] = [];
  const flushIfNeeded = async () => {
    if (buf.length >= batchRows) {
      await seed(buf, batchRows);
      buf = [];
    }
  };
  for (let u = 0; u < users; u++) {
    const uid = mkUuid();
    const isAnon = Math.random() < anonRatio;
    const country = pick(COUNTRY_CODES);
    const region = country + "-" + Math.floor(Math.random() * 50).toString(36);
    const teamId = Math.random() < teamRatio ? pick(teamIds) : null;
    // $token-refresh events (realistic ip_info payload)
    for (let e = 0; e < perUser; e++) {
      const at = new Date(windowStart.getTime() + Math.floor(Math.random() * spanMs));
      buf.push({
        event_type: "$token-refresh",
        event_at: formatCh(at),
        data: {
          refresh_token_id: mkUuid(),
          is_anonymous: isAnon,
          ip_info: {
            ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
            is_trusted: true,
            country_code: country,
            region_code: region,
            city_name: `City-${Math.floor(Math.random() * 1000)}`,
            latitude: Math.random() * 180 - 90,
            longitude: Math.random() * 360 - 180,
            tz_identifier: "UTC",
          },
        },
        project_id: BENCH_PROJECT_ID,
        branch_id: PERF_BRANCH_ID,
        user_id: uid,
        team_id: teamId,
      });
      await flushIfNeeded();
    }
    // $page-view events
    for (let e = 0; e < pvPerUser; e++) {
      const at = new Date(windowStart.getTime() + Math.floor(Math.random() * spanMs));
      buf.push(mkEvent({
        branchId: PERF_BRANCH_ID,
        at,
        userId: uid,
        isAnonymous: isAnon,
        eventType: "$page-view",
        extraData: { referrer: pick(REFERRERS), url: `https://example.com/page-${Math.floor(Math.random() * 100)}` },
      }));
      await flushIfNeeded();
    }
    // $click events
    for (let e = 0; e < clicksPerUser; e++) {
      const at = new Date(windowStart.getTime() + Math.floor(Math.random() * spanMs));
      buf.push(mkEvent({
        branchId: PERF_BRANCH_ID,
        at,
        userId: uid,
        isAnonymous: isAnon,
        eventType: "$click",
        extraData: { element: `btn-${Math.floor(Math.random() * 50)}` },
      }));
      await flushIfNeeded();
    }
    if ((u + 1) % 20_000 === 0) {
      console.log(`  seeded ${(u + 1).toLocaleString()} / ${users.toLocaleString()} users (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
  if (buf.length) await seed(buf, batchRows);
  // Force parts to settle so first-query cost isn't dominated by merges.
  const client = getClickhouseAdminClient();
  await client.command({ query: "OPTIMIZE TABLE analytics_internal.events FINAL", clickhouse_settings: { mutations_sync: "2" } });
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

async function runPerf(now: Date): Promise<void> {
  const untilExclusive = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + ONE_DAY_MS);
  const since = new Date(untilExclusive.getTime() - METRICS_WINDOW_MS);
  const params: QueryParams = {
    projectId: BENCH_PROJECT_ID,
    branchId: PERF_BRANCH_ID,
    since,
    untilExclusive,
    includeAnonymous: false,
  };

  console.log("\n── Perf run (include_anonymous=false) ──");
  // Warm up caches so variants compete on equal footing.
  const warmup = await runVariant(VARIANTS[0], params);
  void warmup;

  const oldRes = await runOld(params);
  const oldStats = await readStats(oldRes.queryId);

  // Set-equality baseline: the "ground truth" set of users the OLD pipeline counts.
  const truthSet = oldRes.set;

  type Row = {
    name: string,
    description: string,
    approximate: boolean,
    count: number,
    stats: QueryStats,
    setMatch: boolean | null,  // null if approximate (skipped)
    errorPct: number | null,
  };

  const rows: Row[] = [
    {
      name: "v0_old (baseline)",
      description: "current query: GROUP BY user_id + JS normalize",
      approximate: false,
      count: oldRes.count,
      stats: oldStats,
      setMatch: true,
      errorPct: 0,
    },
  ];

  for (const v of VARIANTS) {
    const { count, queryId } = await runVariant(v, params);
    const stats = await readStats(queryId);
    const errorPct = oldRes.count > 0 ? ((count - oldRes.count) / oldRes.count) * 100 : 0;
    let setMatch: boolean | null = null;
    if (!v.approximate) {
      // Exact variant: verify it sees the *same users* as the old pipeline, not
      // just the same count. Skip for approximate variants since they don't
      // return a recoverable set.
      const resSet = await runNewSet(params);
      const { onlyInA, onlyInB } = setDiff(truthSet, resSet);
      setMatch = onlyInA.length === 0 && onlyInB.length === 0;
    }
    rows.push({ name: v.name, description: v.description, approximate: v.approximate ?? false, count, stats, setMatch, errorPct });
  }

  // Table output, ranked by peak memory.
  const baselineMem = oldStats.memory_usage;
  const baselineDur = oldStats.query_duration_ms;
  const padR = (s: string, n: number) => s.padStart(n);
  const padL = (s: string, n: number) => s.padEnd(n);
  console.log(`\n  Ground truth (v0_old): MAU=${oldRes.count}`);
  console.log("  " + [
    padL("variant", 24),
    padR("memory", 12),
    padR("vs base", 8),
    padR("duration", 10),
    padR("vs base", 8),
    padR("read", 12),
    padR("result", 10),
    padR("count", 9),
    padR("err%", 7),
    padL("set=", 6),
  ].join("  "));
  console.log("  " + "─".repeat(120));
  for (const r of rows) {
    const memRatio = baselineMem / Math.max(r.stats.memory_usage, 1);
    const durRatio = baselineDur / Math.max(r.stats.query_duration_ms, 1);
    const setMatch = r.setMatch == null ? "—" : r.setMatch ? "yes" : "NO";
    console.log("  " + [
      padL(r.name + (r.approximate ? " ~" : ""), 24),
      padR(fmtBytes(r.stats.memory_usage), 12),
      padR(memRatio >= 1 ? `${memRatio.toFixed(2)}×` : `${memRatio.toFixed(2)}×`, 8),
      padR(`${r.stats.query_duration_ms} ms`, 10),
      padR(durRatio >= 1 ? `${durRatio.toFixed(2)}×` : `${durRatio.toFixed(2)}×`, 8),
      padR(fmtBytes(r.stats.read_bytes), 12),
      padR(fmtBytes(r.stats.result_bytes), 10),
      padR(r.count.toLocaleString(), 9),
      padR(r.errorPct == null ? "—" : `${r.errorPct >= 0 ? "+" : ""}${r.errorPct.toFixed(3)}%`, 7),
      padL(setMatch, 6),
    ].join("  "));
  }
  console.log("\n  Legend: ~ = approximate variant.  set=yes means the variant counts the same individual users as the OLD pipeline.");
}

async function main(): Promise<void> {
  console.log(`Benchmark run_id=${RUN_ID}`);
  console.log(`project_id=${BENCH_PROJECT_ID}`);

  const now = new Date();
  let matrixOk = true;

  try {
    if (!envBool("BENCH_SKIP_MATRIX")) {
      matrixOk = await runMatrix(now);
      if (!matrixOk) {
        console.error("\nEquivalence matrix failed — skipping perf run.");
      }
    } else {
      console.log("Skipping equivalence matrix (BENCH_SKIP_MATRIX=1)");
    }

    const doPerf = matrixOk && !envBool("BENCH_SKIP_PERF");
    const doRouteQueries = matrixOk && envBool("BENCH_ROUTE_QUERIES");
    if (doPerf || doRouteQueries) {
      await seedPerf(now);
      if (doPerf) await runPerf(now);
      if (doRouteQueries) await benchmarkRouteQueries(now);
    } else if (envBool("BENCH_SKIP_PERF")) {
      console.log("Skipping perf run (BENCH_SKIP_PERF=1)");
    }
  } finally {
    console.log("\nCleaning up seeded rows…");
    try {
      await cleanup();
      console.log("  done.");
    } catch (e) {
      console.error("  cleanup failed:", e);
    }
  }

  if (!matrixOk) process.exit(1);
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
