import { getSharedClickhouseAdminClient, type ClickHouseClient } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import {
  CLICKHOUSE_RANKED_SORT_FIELDS,
  ISSUE_LIST_PAGE_SIZE,
  ISSUE_RANK_CANDIDATE_CAP,
  ISSUE_LIST_SORT_FIELDS,
  type IssueListItem,
  type IssueListSortField,
  type IssueStatus,
  type IssueSubstatus,
} from "@hexclave/shared/dist/interface/admin-issues";
import { Prisma } from "@/generated/prisma/client";

/**
 * Reads for the Issues list and detail.
 *
 * ── Why the backend does the join ─────────────────────────────────────────
 * Issue data lives in two stores by design: Postgres owns mutable lifecycle and
 * LIFETIME counters, ClickHouse owns WINDOWED occurrence statistics. Neither
 * can answer a list query alone.
 *
 * The dashboard's usual telemetry path (`POST /analytics/query`) is the wrong
 * tool here: it exists to run CUSTOMER-authored SQL as `limited_user` under row
 * policies, it ships the query text to the browser, it cannot see Postgres, and
 * it caps at 10k rows. This module instead uses the ClickHouse ADMIN client
 * with an explicit `project_id`/`branch_id` predicate derived from the
 * authenticated tenancy — the same trust model `internal/metrics` already uses.
 * Tenant isolation therefore comes from this file, not from a row policy, which
 * is why every query below binds both ids and why there is an E2E test asserting
 * one project cannot read another's issues.
 *
 * ── One plan, Postgres-first ──────────────────────────────────────────────
 * An earlier design ranked ClickHouse hashes BEFORE mapping them to issues and
 * applying status. That is wrong in four separate ways: merged issues consume
 * several slots, resolved hashes crowd out unresolved ones, several hashes
 * collapse to fewer rows than a page, and unique-user counts get SUMMED across
 * hashes when `uniq` states must be MERGED (a user active under two hashes
 * would count twice).
 *
 * So: Postgres selects and orders the candidates (it owns status), ClickHouse
 * supplies the metrics for exactly those candidates' hashes. For the two
 * window-scoped sorts the candidate set is narrowed by status first and then
 * ranked in ClickHouse, with an explicit cap and an `approximate` flag rather
 * than a silent truncation.
 */

export type IssueListFilters = {
  hours: number,
  status: IssueStatus | "all",
  serviceName: string | null,
  environment: string | null,
  /** Occurrence-scoped, so it can only be applied in ClickHouse. */
  handled: boolean | null,
  search: string | null,
  sort: IssueListSortField,
  sortDir: "asc" | "desc",
  cursor: string | null,
  limit: number,
};

type IssueRow = {
  id: string,
  shortId: bigint,
  type: string,
  value: string,
  culprit: string,
  platform: string,
  status: "UNRESOLVED" | "RESOLVED" | "IGNORED",
  firstSeenAt: Date,
  lastSeenAt: Date,
  regressedAt: Date | null,
  timesSeen: bigint,
  countersTruncatedAt: Date | null,
  ignoredUntil: Date | null,
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  lastSeenRelease: string | null,
  updatedAt: Date,
  handled: boolean,
  synthetic: boolean,
  hashes: string[],
};

type WindowStats = {
  issueId: string,
  occurrences: number,
  users: number,
};

type CursorDirection = "asc" | "desc";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIssueListSortField(value: unknown): value is IssueListSortField {
  return ISSUE_LIST_SORT_FIELDS.some((field) => field === value);
}

function isCursorDirection(value: unknown): value is CursorDirection {
  return value === "asc" || value === "desc";
}

function isWindowRankedSort(value: IssueListSortField): value is Extract<IssueListSortField, "events" | "users"> {
  return CLICKHOUSE_RANKED_SORT_FIELDS.some((field) => field === value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Derived at read time, never stored: an issue that is "new" inside a 24h
 * window is "ongoing" inside a 30d one, so persisting it would make the value
 * depend on whoever looked last.
 */
export function deriveSubstatus(
  row: { regressedAt: Date | null, firstSeenAt: Date },
  rangeStart: Date,
): IssueSubstatus {
  if (row.regressedAt !== null && row.regressedAt >= rangeStart) return "regressed";
  if (row.firstSeenAt >= rangeStart) return "new";
  return "ongoing";
}

/**
 * An issue is treated as unresolved once its snooze has lapsed, even before the
 * next occurrence arrives to flip the stored column.
 *
 * The stored flip happens lazily, inside the ingest `UPDATE` (see
 * `issue-store.ts`) — deliberately, because an ignored issue that never recurs
 * *should* stay ignored, and a cron that woke them all up would be wrong. That
 * leaves a window where the stored status says IGNORED but the user's intent
 * has expired, so the read path compensates.
 */
function effectiveStatus(row: Pick<IssueRow, "status">, ignoredUntil: Date | null, now: Date): IssueStatus {
  if (row.status === "IGNORED" && ignoredUntil !== null && ignoredUntil < now) return "unresolved";
  if (row.status === "RESOLVED") return "resolved";
  if (row.status === "IGNORED") return "ignored";
  return "unresolved";
}

export type IssueListCursor = {
  /** Kept under this name for compatibility with already-issued opaque cursors. */
  lastSeenAtMillis: number,
  id: string,
  sort?: IssueListSortField,
  sortDir?: CursorDirection,
};

/**
 * Shared by the list and the detail route so the two cannot disagree about the
 * same issue. Both are window-relative: a 30-day-old regression is `ongoing` in
 * a 24h view and `regressed` in a 30d one, and a detail page that hardcoded its
 * own window would contradict the row the user clicked to get there.
 */
export function issueRangeStart(hours: number, now: Date): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

export function encodeIssueCursor(cursor: IssueListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeIssueCursor(
  raw: string,
  expected?: { sort: IssueListSortField, sortDir: CursorDirection },
): IssueListCursor | null {
  try {
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!isRecord(parsed)) return null;

    const { lastSeenAtMillis, id, sort, sortDir } = parsed;
    if (
      typeof lastSeenAtMillis !== "number"
      || !Number.isSafeInteger(lastSeenAtMillis)
      || lastSeenAtMillis < 0
      || lastSeenAtMillis > 8_640_000_000_000_000
      || typeof id !== "string"
      || !isUuid(id)
    ) return null;
    if (sort !== undefined && !isIssueListSortField(sort)) return null;
    if (sortDir !== undefined && !isCursorDirection(sortDir)) return null;
    if (expected !== undefined && (
      (sort !== undefined && sort !== expected.sort)
      || (sortDir !== undefined && sortDir !== expected.sortDir)
    )) return null;

    return {
      lastSeenAtMillis,
      id,
      ...sort === undefined ? {} : { sort },
      ...sortDir === undefined ? {} : { sortDir },
    };
  } catch {
    // A malformed cursor is a client bug, not a server error: fall back to the
    // first page rather than 500ing on a stale bookmark.
    return null;
  }
}

/**
 * `handled` is a property of the ERROR, not of a time window — every occurrence
 * of one grouped error shares a mechanism — so it is persisted on the Issue row
 * and filtered here, beside status, rather than requiring a second pass over
 * ClickHouse occurrences.
 */
function handledFilterSql(handled: boolean | null): Prisma.Sql {
  if (handled === null) return Prisma.sql``;
  return Prisma.sql`AND i."handled" = ${handled}`;
}

function searchFilterSql(search: string | null): Prisma.Sql {
  if (search === null || search.trim() === "") return Prisma.sql``;
  // Deliberately a prefix/substring match over the denormalized display
  // fields rather than full-text search: these three columns are what the
  // list renders, so matching anything else would highlight nothing.
  return Prisma.sql`AND (i."type" ILIKE ${`%${search}%`} OR i."value" ILIKE ${`%${search}%`} OR i."culprit" ILIKE ${`%${search}%`})`;
}

function occurrenceHashFilterSql(matchingHashes: readonly string[] | null): Prisma.Sql {
  if (matchingHashes === null) return Prisma.sql``;
  if (matchingHashes.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND EXISTS (
    SELECT 1
    FROM "IssueHash" h
    WHERE h."tenancyId" = i."tenancyId"
      AND h."issueId" = i."id"
      AND h."hash" = ANY(${matchingHashes}::text[])
  )`;
}

/**
 * Filters on the EFFECTIVE status, not the stored one.
 *
 * An issue whose `ignoredUntil` has lapsed is rendered as unresolved by
 * `effectiveStatus` and counted as unresolved by the counts query, so filtering
 * on the raw column would make `?status=unresolved` fail to return a row the
 * same response describes as unresolved.
 */
function statusFilterSql(status: IssueStatus | "all", now: Date): Prisma.Sql {
  if (status === "all") return Prisma.sql``;
  const lapsedSnooze = Prisma.sql`(i."status" = 'IGNORED' AND i."ignoredUntil" IS NOT NULL AND i."ignoredUntil" < ${now}::timestamptz)`;
  if (status === "unresolved") {
    return Prisma.sql`AND (i."status" = 'UNRESOLVED' OR ${lapsedSnooze})`;
  }
  if (status === "ignored") {
    return Prisma.sql`AND i."status" = 'IGNORED' AND NOT ${lapsedSnooze}`;
  }
  return Prisma.sql`AND i."status" = ${status.toUpperCase()}::"IssueStatus"`;
}

/**
 * Loads candidate issues plus their owned hashes in ONE query.
 *
 * The `hashes` array is aggregated in the same statement rather than fetched
 * per issue — a second round trip per row is exactly the N+1 this whole design
 * exists to avoid, and the dashboard needs those hashes anyway to batch its
 * sparkline query for the entire page.
 */
async function loadCandidateIssues(
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancyId: string,
  filters: IssueListFilters,
  rangeStart: Date,
  now: Date,
  limit: number,
  matchingHashes: readonly string[] | null,
): Promise<IssueRow[]> {
  const rankedSort = isWindowRankedSort(filters.sort) ? filters.sort : null;
  const isWindowRanked = rankedSort !== null;
  const cursor = filters.cursor === null || isWindowRanked
    ? null
    : decodeIssueCursor(filters.cursor, { sort: filters.sort, sortDir: filters.sortDir });
  const cursorSql = cursor === null
    ? Prisma.sql``
    : filters.sortDir === "asc"
      ? Prisma.sql`AND (${filters.sort === "first_seen" ? Prisma.sql`i."firstSeenAt"` : Prisma.sql`i."lastSeenAt"`}, i."id") > (${new Date(cursor.lastSeenAtMillis)}::timestamptz, ${cursor.id}::uuid)`
      : Prisma.sql`AND (${filters.sort === "first_seen" ? Prisma.sql`i."firstSeenAt"` : Prisma.sql`i."lastSeenAt"`}, i."id") < (${new Date(cursor.lastSeenAtMillis)}::timestamptz, ${cursor.id}::uuid)`;

  // The cursor must be keyed on the SAME column the rows are ordered by, or the
  // next page silently skips or repeats rows. `sortColumn` is chosen from a
  // closed set rather than interpolated from the request.
  const sortColumn = filters.sort === "first_seen" ? Prisma.sql`i."firstSeenAt"` : Prisma.sql`i."lastSeenAt"`;
  const descending = filters.sortDir !== "asc";
  const orderSql = descending
    ? Prisma.sql`ORDER BY ${sortColumn} DESC, i."id" DESC`
    : Prisma.sql`ORDER BY ${sortColumn} ASC, i."id" ASC`;

  return await prisma.$replica().$queryRaw<IssueRow[]>(Prisma.sql`
    SELECT
      i."id", i."shortId", i."type", i."value", i."culprit", i."platform",
      i."status"::text AS "status", i."firstSeenAt", i."lastSeenAt", i."regressedAt",
      i."timesSeen", i."countersTruncatedAt", i."ignoredUntil",
      i."serviceName", i."deploymentEnvironmentName", i."lastSeenRelease", i."updatedAt",
      i."handled", i."synthetic",
      COALESCE(
        (SELECT array_agg(h."hash") FROM "IssueHash" h
         WHERE h."tenancyId" = i."tenancyId" AND h."issueId" = i."id"),
        ARRAY[]::text[]
      ) AS "hashes"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancyId}::uuid
      AND i."lastSeenAt" >= ${rangeStart}::timestamptz
      ${statusFilterSql(filters.status, now)}
      ${handledFilterSql(filters.handled)}
      ${searchFilterSql(filters.search)}
      ${occurrenceHashFilterSql(matchingHashes)}
      ${cursorSql}
    ${orderSql}
    LIMIT ${limit}
  `);
}

async function loadMatchingHashes(
  clickhouse: ClickHouseClient,
  projectId: string,
  branchId: string,
  rangeStart: Date,
  filters: Pick<IssueListFilters, "serviceName" | "environment">,
): Promise<string[] | null> {
  if (filters.serviceName === null && filters.environment === null) return null;

  const serviceFilter = filters.serviceName === null ? "" : "AND service_name = {service:String}";
  const environmentFilter = filters.environment === null ? "" : "AND deployment_environment_name = {environment:String}";
  const resultSet = await clickhouse.query({
    query: `
      SELECT DISTINCT issue_hash AS issueHash
      FROM analytics_internal.issue_occurrence_rollup
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND bucket_start >= {rangeStart:DateTime}
        ${serviceFilter}
        ${environmentFilter}
    `,
    query_params: {
      projectId,
      branchId,
      rangeStart: Math.floor(rangeStart.getTime() / 1000),
      ...filters.serviceName === null ? {} : { service: filters.serviceName },
      ...filters.environment === null ? {} : { environment: filters.environment },
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{ issueHash: string }>();
  return rows.map((row) => row.issueHash);
}

/**
 * Window-scoped stats for a known set of hashes, in one ClickHouse query.
 *
 * `uniqMerge(users_state)` — never `sum` of per-hash user counts. The rollup
 * stores a `uniq` aggregate STATE precisely so several hashes belonging to one
 * issue can be combined without double-counting a user who appeared under both.
 */
async function loadWindowStats(
  clickhouse: ClickHouseClient,
  projectId: string,
  branchId: string,
  issues: readonly Pick<IssueRow, "id" | "hashes">[],
  rangeStart: Date,
  filters: IssueListFilters,
): Promise<Map<string, WindowStats>> {
  const hashToIssue = issues.flatMap((issue) => issue.hashes.map((hash) => ({ hash, issueId: issue.id })));
  if (hashToIssue.length === 0) return new Map();

  const hashes = hashToIssue.map((entry) => entry.hash);
  const issueIds = hashToIssue.map((entry) => entry.issueId);

  const serviceFilter = filters.serviceName === null ? "" : "AND service_name = {service:String}";
  const environmentFilter = filters.environment === null ? "" : "AND deployment_environment_name = {environment:String}";

  const resultSet = await clickhouse.query({
    query: `
      WITH mapFromArrays({hashes:Array(String)}, {issueIds:Array(String)}) AS issue_by_hash
      SELECT
        issue_by_hash[issue_hash] AS issueId,
        toUInt64(sum(occurrences)) AS occurrences,
        toUInt64(uniqMerge(users_state)) AS users
      FROM analytics_internal.issue_occurrence_rollup
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND issue_hash IN {hashes:Array(String)}
        AND bucket_start >= {rangeStart:DateTime}
        ${serviceFilter}
        ${environmentFilter}
        AND issue_by_hash[issue_hash] != ''
      GROUP BY issueId
    `,
    query_params: {
      projectId,
      branchId,
      hashes,
      issueIds,
      rangeStart: Math.floor(rangeStart.getTime() / 1000),
      ...filters.serviceName === null ? {} : { service: filters.serviceName },
      ...filters.environment === null ? {} : { environment: filters.environment },
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{ issueId: string, occurrences: string, users: string }>();
  return new Map(rows.map((row) => [row.issueId, {
    issueId: row.issueId,
    occurrences: Number(row.occurrences),
    users: Number(row.users),
  }]));
}

function toListItem(row: IssueRow, stats: Map<string, WindowStats>, rangeStart: Date, now: Date, ignoredUntil: Date | null): IssueListItem {
  // The ClickHouse query merges `users_state` across every hash owned by this
  // issue. Taking the old per-hash max was only a lower bound and disagreed
  // with the detail view whenever two hashes had disjoint users.
  const stat = stats.get(row.id);
  const occurrences = stat?.occurrences ?? 0;
  const users = stat?.users ?? 0;

  return {
    id: row.id,
    short_id: row.shortId.toString(),
    type: row.type,
    value: row.value,
    culprit: row.culprit,
    level: "error",
    status: effectiveStatus(row, ignoredUntil, now),
    substatus: deriveSubstatus(row, rangeStart),
    first_seen_at_millis: row.firstSeenAt.getTime(),
    last_seen_at_millis: row.lastSeenAt.getTime(),
    times_seen: row.timesSeen.toString(),
    counters_truncated_at_millis: row.countersTruncatedAt?.getTime() ?? null,
    window_occurrences: occurrences,
    window_users: users,
    service_name: row.serviceName,
    environment: row.deploymentEnvironmentName,
    release: row.lastSeenRelease,
    handled: row.handled,
    synthetic: row.synthetic,
    updated_at_millis: row.updatedAt.getTime(),
    issue_hashes: row.hashes,
  };
}

/**
 * Window-scoped occurrence/user counts for ONE issue's owned hashes.
 *
 * The detail view needs the same numbers the list column shows, so both go
 * through the rollup rather than the list computing them and the detail page
 * inventing its own. `uniqMerge` — never a sum — because a user who appeared
 * under two of the issue's hashes must count once.
 */
export async function loadIssueWindowStats(options: {
  tenancy: Tenancy,
  hashes: readonly string[],
  rangeStart: Date,
}): Promise<{ occurrences: number, users: number }> {
  const { tenancy, hashes, rangeStart } = options;
  if (hashes.length === 0) return { occurrences: 0, users: 0 };

  const resultSet = await getSharedClickhouseAdminClient().query({
    query: `
      SELECT toUInt64(sum(occurrences)) AS occurrences, toUInt64(uniqMerge(users_state)) AS users
      FROM analytics_internal.issue_occurrence_rollup
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND issue_hash IN {hashes:Array(String)}
        AND bucket_start >= {rangeStart:DateTime}
    `,
    query_params: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      hashes,
      rangeStart: Math.floor(rangeStart.getTime() / 1000),
    },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ occurrences: string, users: string }>();
  if (rows.length === 0) return { occurrences: 0, users: 0 };
  return { occurrences: Number(rows[0].occurrences), users: Number(rows[0].users) };
}

export type OccurrenceCursor = { eventAtMillis: number, occurrenceId: string };

export function encodeOccurrenceCursor(cursor: OccurrenceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeOccurrenceCursor(raw: string): OccurrenceCursor | null {
  try {
    if (raw.length === 0) return null;
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!isRecord(parsed)) return null;
    const { eventAtMillis, occurrenceId } = parsed;
    if (
      typeof eventAtMillis !== "number"
      || !Number.isSafeInteger(eventAtMillis)
      || eventAtMillis < 0
      || eventAtMillis > 8_640_000_000_000_000
      || typeof occurrenceId !== "string"
      || occurrenceId.length === 0
      || occurrenceId.length > 256
    ) return null;
    return { eventAtMillis, occurrenceId };
  } catch {
    return null;
  }
}

type OccurrenceRow = {
  occurrence_id: string,
  event_at: string,
  message: string,
  level: string,
  // ClickHouse returns the `JSON`-typed column already parsed under
  // JSONEachRow, so this is an object rather than a string to re-parse.
  data: Record<string, unknown>,
  /** Bounded canonical ErrorEnvelope JSON stored as one stable read-model column. */
  error_envelope: string,
  /** Ordered primary/secondary grouping evidence; `[]` for legacy rows. */
  issue_grouping_provenance: string,
  error_frames: string,
  trace_id: string | null,
  span_id: string | null,
  page_view_span_id: string | null,
  session_replay_id: string | null,
  user_id: string | null,
  service_name: string | null,
  deployment_environment_name: string | null,
};

/**
 * One occurrence of an issue, paginated by `(event_at, occurrence_id)`.
 *
 * The tie-break on `occurrence_id` is not decorative: a batch of 500 errors
 * from one page load can share a millisecond, and a cursor on `event_at` alone
 * would either skip or repeat those rows. `occurrence_id` is deterministic
 * (`sha256(batch_id ‖ ordinal)`), so the ordering is stable across retries too.
 *
 * Occurrences are resolved by the issue's OWNED hashes against the scalar
 * `issue_hash` column — never `hasAny(issue_hashes, …)`. `issue_hashes` holds
 * alias variants, and matching on it would make one occurrence belong to two
 * issues after an unmerge.
 */
export async function loadOccurrence(options: {
  tenancy: Tenancy,
  hashes: readonly string[],
  cursor: OccurrenceCursor | null,
  direction: "older" | "newer",
}): Promise<{ occurrence: OccurrenceRow | null, newerCursor: string | null, olderCursor: string | null }> {
  const { tenancy, hashes, cursor, direction } = options;
  if (hashes.length === 0) return { occurrence: null, newerCursor: null, olderCursor: null };

  const clickhouse = getSharedClickhouseAdminClient();
  const comparison = cursor === null
    ? ""
    : direction === "older"
      ? "AND (event_at, occurrence_id) < ({cursorAt:DateTime64(3)}, {cursorId:String})"
      : "AND (event_at, occurrence_id) > ({cursorAt:DateTime64(3)}, {cursorId:String})";
  const order = direction === "older" ? "DESC" : "ASC";

  const resultSet = await clickhouse.query({
    query: `
      SELECT occurrence_id, event_at, body AS message, level, data, error_envelope,
             issue_grouping_provenance, error_frames,
             trace_id, span_id, page_view_span_id, session_replay_id, user_id,
             service_name, deployment_environment_name
      FROM analytics_internal.logs
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND event_type = '$error'
        AND issue_hash IN {hashes:Array(String)}
        ${comparison}
      ORDER BY event_at ${order}, occurrence_id ${order}
      LIMIT 2
    `,
    query_params: {
      projectId: tenancy.project.id,
      branchId: tenancy.branchId,
      hashes,
      ...cursor === null ? {} : {
        cursorAt: new Date(cursor.eventAtMillis).toISOString().replace("T", " ").replace("Z", ""),
        cursorId: cursor.occurrenceId,
      },
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<OccurrenceRow>();
  if (rows.length === 0) return { occurrence: null, newerCursor: null, olderCursor: null };
  const occurrence = rows[0];

  const eventAtMillis = new Date(`${occurrence.event_at}Z`).getTime();
  if (!Number.isSafeInteger(eventAtMillis) || eventAtMillis < 0) {
    throw new Error(`ClickHouse returned an invalid issue occurrence timestamp: ${occurrence.event_at}`);
  }
  const position = { eventAtMillis, occurrenceId: occurrence.occurrence_id };
  const hasAnotherInDirection = rows.length > 1;
  const inputCursor = cursor === null ? null : encodeOccurrenceCursor(cursor);
  return {
    occurrence,
    // The second row is the next row in the requested direction. The input
    // cursor is the immediate neighbor in the opposite direction, so this
    // yields real terminal cursors without an extra query per navigation.
    newerCursor: direction === "newer"
      ? hasAnotherInDirection ? encodeOccurrenceCursor(position) : null
      : inputCursor,
    olderCursor: direction === "older"
      ? hasAnotherInDirection ? encodeOccurrenceCursor(position) : null
      : inputCursor,
  };
}

export function compareRankedIssues(
  left: Pick<IssueListItem, "window_occurrences" | "window_users" | "last_seen_at_millis" | "id">,
  right: Pick<IssueListItem, "window_occurrences" | "window_users" | "last_seen_at_millis" | "id">,
  sort: Extract<IssueListSortField, "events" | "users">,
  sortDir: CursorDirection,
): number {
  const leftMetric = sort === "events" ? left.window_occurrences : left.window_users;
  const rightMetric = sort === "events" ? right.window_occurrences : right.window_users;
  const direction = sortDir === "desc" ? -1 : 1;
  const metricComparison = leftMetric === rightMetric ? 0 : leftMetric < rightMetric ? -1 : 1;
  if (metricComparison !== 0) return metricComparison * direction;

  const timeComparison = left.last_seen_at_millis === right.last_seen_at_millis
    ? 0
    : left.last_seen_at_millis < right.last_seen_at_millis ? -1 : 1;
  if (timeComparison !== 0) return timeComparison * direction;
  return stringCompare(left.id, right.id) * direction;
}

export async function listIssues(options: {
  tenancy: Tenancy,
  filters: IssueListFilters,
}): Promise<{ items: IssueListItem[], cursor: string | null, counts: { unresolved: number, resolved: number, ignored: number }, approximate: boolean }> {
  const { tenancy, filters } = options;
  const prisma = await getPrismaClientForTenancy(tenancy);
  const clickhouse = getSharedClickhouseAdminClient();
  const now = new Date();
  const rangeStart = new Date(now.getTime() - filters.hours * 60 * 60 * 1000);
  const limit = Math.min(filters.limit, ISSUE_LIST_PAGE_SIZE);

  const rankedSort = isWindowRankedSort(filters.sort) ? filters.sort : null;
  const isWindowRanked = rankedSort !== null;
  const matchingHashes = await loadMatchingHashes(clickhouse, tenancy.project.id, tenancy.branchId, rangeStart, filters);

  // Window-scoped sorts must be ranked by ClickHouse, so the candidate set is
  // widened (status-filtered but not paginated) and capped. Beyond the cap the
  // ranking is over a bounded subset, which the response admits via
  // `approximate` — "the top N issues" and "a correct ranking over a declared
  // candidate set" are different claims, and only one of them is honest.
  const candidateLimit = isWindowRanked ? ISSUE_RANK_CANDIDATE_CAP : limit + 1;
  const candidates = await loadCandidateIssues(prisma, tenancy.id, filters, rangeStart, now, candidateLimit, matchingHashes);
  const approximate = isWindowRanked && candidates.length >= ISSUE_RANK_CANDIDATE_CAP;

  const stats = await loadWindowStats(clickhouse, tenancy.project.id, tenancy.branchId, candidates, rangeStart, filters);

  // The CASE mirrors `effectiveStatus` below. Counting the raw stored column
  // instead would make the tab badge say "ignored: 1" for an issue the list
  // itself renders as unresolved, which reads as a bug to anyone looking at it.
  const counts = await prisma.$replica().$queryRaw<{ status: string, count: bigint }[]>(Prisma.sql`
    SELECT
      CASE
        WHEN i."status" = 'IGNORED' AND i."ignoredUntil" IS NOT NULL AND i."ignoredUntil" < ${now}::timestamptz
          THEN 'UNRESOLVED'
        ELSE i."status"::text
      END AS "status",
      count(*) AS "count"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid AND i."lastSeenAt" >= ${rangeStart}::timestamptz
      ${handledFilterSql(filters.handled)}
      ${searchFilterSql(filters.search)}
      ${occurrenceHashFilterSql(matchingHashes)}
    GROUP BY 1
  `);
  const countByStatus = new Map(counts.map((row) => [row.status, Number(row.count)]));

  let items = candidates.map((row) => toListItem(
    row,
    stats,
    rangeStart,
    now,
    row.ignoredUntil,
  ));

  if (isWindowRanked) {
    items.sort((left, right) => compareRankedIssues(left, right, rankedSort, filters.sortDir));
    items = items.slice(0, limit);
  }

  const hasMore = !isWindowRanked && items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page.at(-1);

  return {
    items: page,
    cursor: hasMore && last !== undefined
      ? encodeIssueCursor({
        // Named `lastSeenAtMillis` for wire compatibility, but it carries the
        // value of whichever column the ordering used.
        lastSeenAtMillis: filters.sort === "first_seen" ? last.first_seen_at_millis : last.last_seen_at_millis,
        id: last.id,
        sort: filters.sort,
        sortDir: filters.sortDir,
      })
      : null,
    counts: {
      unresolved: countByStatus.get("UNRESOLVED") ?? 0,
      resolved: countByStatus.get("RESOLVED") ?? 0,
      ignored: countByStatus.get("IGNORED") ?? 0,
    },
    approximate,
  };
}
