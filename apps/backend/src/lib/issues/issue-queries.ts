import { getSharedClickhouseAdminClient, type ClickHouseClient } from "@/lib/clickhouse";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import {
  CLICKHOUSE_RANKED_SORT_FIELDS,
  ISSUE_LIST_PAGE_SIZE,
  ISSUE_RANK_CANDIDATE_CAP,
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
  serviceName: string | null,
  deploymentEnvironmentName: string | null,
  lastSeenRelease: string | null,
  updatedAt: Date,
  handled: boolean,
  synthetic: boolean,
  hashes: string[],
};

type WindowStats = {
  issueHash: string,
  occurrences: number,
  users: number,
};

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
  return row.status.toLowerCase() as IssueStatus;
}

export type IssueListCursor = { lastSeenAtMillis: number, id: string };

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

export function decodeIssueCursor(raw: string): IssueListCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { lastSeenAtMillis, id } = parsed as Record<string, unknown>;
    if (typeof lastSeenAtMillis !== "number" || typeof id !== "string") return null;
    return { lastSeenAtMillis, id };
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
): Promise<IssueRow[]> {
  const cursor = filters.cursor === null ? null : decodeIssueCursor(filters.cursor);
  const cursorSql = cursor === null
    ? Prisma.sql``
    : filters.sortDir === "asc"
      ? Prisma.sql`AND (${filters.sort === "first_seen" ? Prisma.sql`i."firstSeenAt"` : Prisma.sql`i."lastSeenAt"`}, i."id") > (${new Date(cursor.lastSeenAtMillis)}::timestamptz, ${cursor.id}::uuid)`
      : Prisma.sql`AND (${filters.sort === "first_seen" ? Prisma.sql`i."firstSeenAt"` : Prisma.sql`i."lastSeenAt"`}, i."id") < (${new Date(cursor.lastSeenAtMillis)}::timestamptz, ${cursor.id}::uuid)`;

  const searchSql = filters.search === null || filters.search.trim() === ""
    ? Prisma.sql``
    // Deliberately a prefix/substring match over the denormalized display
    // fields rather than full-text search: these three columns are what the
    // list renders, so matching anything else would highlight nothing.
    : Prisma.sql`AND (i."type" ILIKE ${`%${filters.search}%`} OR i."value" ILIKE ${`%${filters.search}%`} OR i."culprit" ILIKE ${`%${filters.search}%`})`;

  // The cursor must be keyed on the SAME column the rows are ordered by, or the
  // next page silently skips or repeats rows. `sortColumn` is chosen from a
  // closed set rather than interpolated from the request.
  const sortColumn = filters.sort === "first_seen" ? Prisma.sql`i."firstSeenAt"` : Prisma.sql`i."lastSeenAt"`;
  const descending = filters.sortDir !== "asc";
  const orderSql = descending
    ? Prisma.sql`ORDER BY ${sortColumn} DESC, i."id" DESC`
    : Prisma.sql`ORDER BY ${sortColumn} ASC, i."id" ASC`;

  return await prisma.$queryRaw<IssueRow[]>(Prisma.sql`
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
      ${searchSql}
      ${cursorSql}
    ${orderSql}
    LIMIT ${limit}
  `);
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
  hashes: readonly string[],
  rangeStart: Date,
  filters: IssueListFilters,
): Promise<Map<string, WindowStats>> {
  if (hashes.length === 0) return new Map();

  const serviceFilter = filters.serviceName === null ? "" : "AND service_name = {service:String}";
  const environmentFilter = filters.environment === null ? "" : "AND deployment_environment_name = {environment:String}";

  const resultSet = await clickhouse.query({
    query: `
      SELECT
        issue_hash AS issueHash,
        toUInt64(sum(occurrences)) AS occurrences,
        toUInt64(uniqMerge(users_state)) AS users
      FROM analytics_internal.issue_occurrence_rollup
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND issue_hash IN {hashes:Array(String)}
        AND bucket_start >= {rangeStart:DateTime}
        ${serviceFilter}
        ${environmentFilter}
      GROUP BY issue_hash
    `,
    query_params: {
      projectId,
      branchId,
      hashes,
      rangeStart: Math.floor(rangeStart.getTime() / 1000),
      ...filters.serviceName === null ? {} : { service: filters.serviceName },
      ...filters.environment === null ? {} : { environment: filters.environment },
    },
    format: "JSONEachRow",
  });

  const rows = await resultSet.json<{ issueHash: string, occurrences: string, users: string }>();
  return new Map(rows.map((row) => [row.issueHash, {
    issueHash: row.issueHash,
    occurrences: Number(row.occurrences),
    users: Number(row.users),
  }]));
}

function toListItem(row: IssueRow, stats: Map<string, WindowStats>, rangeStart: Date, now: Date, ignoredUntil: Date | null): IssueListItem {
  // Sum occurrences across the issue's hashes, but take the MAX of users rather
  // than the sum: the per-hash `uniq` states were already merged per hash, and
  // summing them would double-count a user seen under two hashes of the same
  // issue. Merging across hashes exactly would require a second grouped query;
  // max is the correct lower bound and is never an overcount.
  let occurrences = 0;
  let users = 0;
  for (const hash of row.hashes) {
    const stat = stats.get(hash);
    if (stat === undefined) continue;
    occurrences += stat.occurrences;
    users = Math.max(users, stat.users);
  }

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
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { eventAtMillis, occurrenceId } = parsed as Record<string, unknown>;
    if (typeof eventAtMillis !== "number" || typeof occurrenceId !== "string") return null;
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
      SELECT occurrence_id, event_at, message, level, data, error_frames,
             trace_id, span_id, page_view_span_id, session_replay_id, user_id,
             service_name, deployment_environment_name
      FROM analytics_internal.logs
      WHERE project_id = {projectId:String}
        AND branch_id = {branchId:String}
        AND event_type = '$error'
        AND issue_hash IN {hashes:Array(String)}
        ${comparison}
      ORDER BY event_at ${order}, occurrence_id ${order}
      LIMIT 1
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

  const position = { eventAtMillis: new Date(`${occurrence.event_at}Z`).getTime(), occurrenceId: occurrence.occurrence_id };
  return {
    occurrence,
    // Both cursors are emitted unconditionally rather than probed for
    // existence: proving "there is a newer one" costs a second query per
    // navigation, and a dead-end arrow is a far cheaper failure than doubling
    // the query count of every step through an issue's history.
    newerCursor: encodeOccurrenceCursor(position),
    olderCursor: encodeOccurrenceCursor(position),
  };
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

  const isWindowRanked = CLICKHOUSE_RANKED_SORT_FIELDS.includes(filters.sort);

  // Window-scoped sorts must be ranked by ClickHouse, so the candidate set is
  // widened (status-filtered but not paginated) and capped. Beyond the cap the
  // ranking is over a bounded subset, which the response admits via
  // `approximate` — "the top N issues" and "a correct ranking over a declared
  // candidate set" are different claims, and only one of them is honest.
  const candidateLimit = isWindowRanked ? ISSUE_RANK_CANDIDATE_CAP : limit + 1;
  const candidates = await loadCandidateIssues(prisma, tenancy.id, filters, rangeStart, now, candidateLimit);
  const approximate = isWindowRanked && candidates.length >= ISSUE_RANK_CANDIDATE_CAP;

  const allHashes = [...new Set(candidates.flatMap((row) => row.hashes))];
  const stats = await loadWindowStats(clickhouse, tenancy.project.id, tenancy.branchId, allHashes, rangeStart, filters);

  // The CASE mirrors `effectiveStatus` below. Counting the raw stored column
  // instead would make the tab badge say "ignored: 1" for an issue the list
  // itself renders as unresolved, which reads as a bug to anyone looking at it.
  const counts = await prisma.$queryRaw<{ status: string, count: bigint }[]>`
    SELECT
      CASE
        WHEN i."status" = 'IGNORED' AND i."ignoredUntil" IS NOT NULL AND i."ignoredUntil" < ${now}::timestamptz
          THEN 'UNRESOLVED'
        ELSE i."status"::text
      END AS "status",
      count(*) AS "count"
    FROM "Issue" i
    WHERE i."tenancyId" = ${tenancy.id}::uuid AND i."lastSeenAt" >= ${rangeStart}::timestamptz
    GROUP BY 1
  `;
  const countByStatus = new Map(counts.map((row) => [row.status, Number(row.count)]));

  let items = candidates.map((row) => toListItem(
    row,
    stats,
    rangeStart,
    now,
    (row as IssueRow & { ignoredUntil: Date | null }).ignoredUntil,
  ));

  // A service/environment filter is occurrence-scoped, so an issue that has no
  // rollup rows under that filter did not occur there and must drop out. This
  // cannot be done in Postgres: `Issue.serviceName` is only the LAST observed
  // service, and an issue can legitimately span several.
  if (filters.serviceName !== null || filters.environment !== null) {
    items = items.filter((item) => item.window_occurrences > 0);
  }

  if (isWindowRanked) {
    const key = filters.sort === "events" ? "window_occurrences" : "window_users";
    items.sort((a, b) => filters.sortDir === "desc" ? b[key] - a[key] : a[key] - b[key]);
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
