import { getClickhouseAdminClient, type ClickHouseClient } from "@/lib/clickhouse";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ERRORS_VIEW_SQL,
  ERROR_GROUPING_COLUMNS,
  ERROR_GROUPING_COLUMN_NAMES,
  ERROR_ENVELOPE_COLUMN_NAMES,
  EVENTS_COLUMNS,
  EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL,
  EVENTS_EVENT_TYPE_INDEX_NAME,
  LOGS_COLUMNS,
  OTEL_LOG_COLUMNS,
  LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL,
  LOGS_ISSUE_HASH_INDEX_NAME,
  LOGS_VIEW_SQL,
  REFRESH_TOKEN_SPAN_SELECT_ALIASES,
  REFRESH_TOKEN_SPAN_SELECT_SQL,
  SPANS_COLUMNS,
  OTEL_METRICS_COLUMNS,
  SPANS_VIEW_SQL,
  SPAN_EVENTS_VIEW_SQL,
  SPAN_LINKS_COLUMNS,
  SPAN_EVENTS_COLUMNS,
  SPAN_WRITES_TTL_DAYS,
  TELEMETRY_COLUMNS,
  TELEMETRY_INSERT_DEDUPLICATION_WINDOW,
  TELEMETRY_INSERT_TABLES,
  TELEMETRY_TTL_DAYS,
  TRACE_ROOTS_COLUMNS,
  TRACE_ROOTS_SOURCE_SELECT_SQL,
  TRACE_ROOTS_VIEW_SQL,
  TRACE_SERVICES_COLUMNS,
  TRACE_SERVICES_SOURCE_SELECT_SQL,
  buildColumnUpgradeSql,
  computeIssuesSubsystemFingerprint,
  computeSpansSubsystemFingerprint,
  buildIssueOccurrenceRollupCreateTableSql,
  buildIssueOccurrenceRollupMvSql,
  buildSpanEventsCreateTableSql,
  buildSpanLinksCreateTableSql,
  buildSpanWritesCreateTableSql,
  buildSpanWritesMvSql,
  buildSpansCreateTableSql,
  buildTelemetryCreateTableSql,
  buildOtelMetricsCreateTableSql,
  buildTelemetryInsertDeduplicationSettingSql,
  buildTraceRootsCreateTableSql,
  buildTraceServicesCreateTableSql,
  backfillDerivedSpanTable,
  ensureSkipIndex,
  ensureTableTtl,
  selectColumnNames,
  type ClickhouseColumn,
} from "./clickhouse-migrations";


function names(columns: readonly ClickhouseColumn[]): string[] {
  return columns.map((column) => column.name);
}

describe("default.spans", () => {
  test("exposes physical spans plus the canonical W3C refresh-token root", () => {
    expect(SPANS_VIEW_SQL).toContain("FROM analytics_internal.spans FINAL");
    expect(SPANS_VIEW_SQL).toContain("UNION ALL");
    expect(SPANS_VIEW_SQL).toContain(REFRESH_TOKEN_SPAN_SELECT_SQL);
    expect(REFRESH_TOKEN_SPAN_SELECT_ALIASES).toEqual(names(SPANS_COLUMNS).filter((name) => name !== "version"));
    expect(REFRESH_TOKEN_SPAN_SELECT_SQL).toContain("'$refresh-token'");
    // ClickHouse resolves aliases across the whole SELECT. Qualifying both
    // timestamps prevents the later `sync_created_at AS created_at` alias from
    // rewriting the token's true interval start to its latest sync time.
    expect(REFRESH_TOKEN_SPAN_SELECT_SQL).toContain("rt.created_at AS started_at");
    expect(REFRESH_TOKEN_SPAN_SELECT_SQL).toContain("rt.sync_created_at AS created_at");
    expect(REFRESH_TOKEN_SPAN_SELECT_SQL).toContain("FROM analytics_internal.refresh_tokens AS rt FINAL");
    expect(REFRESH_TOKEN_SPAN_SELECT_SQL).toContain("AS parent_span_id");
    expect(REFRESH_TOKEN_SPAN_SELECT_SQL).toContain("AS page_view_span_id");
  });
});

describe("spans subsystem fingerprint", () => {
  test("is a stable digest of the physical spans-subsystem definitions", () => {
    const current = computeSpansSubsystemFingerprint();
    expect(current).toMatch(/^[0-9a-f]{32}$/);
    expect(current).toBe(computeSpansSubsystemFingerprint());
  });
});

describe("derived read models", () => {
  test("the trace inbox is fed by the scalar-parent root test", () => {
    // The parent-null test is the ONLY definition of "trace root" in the
    // derived index, and the materialized view fires on INSERT — so if it ever
    // references a column that does not exist, span ingestion breaks rather
    // than deployment.
    expect(TRACE_ROOTS_SOURCE_SELECT_SQL).toContain("WHERE parent_span_id IS NULL");
  });

  test("the trace inbox remains a neutral parentless-span projection", () => {
    expect(TRACE_ROOTS_SOURCE_SELECT_SQL).toContain("WHERE parent_span_id IS NULL");
    for (const sql of [TRACE_ROOTS_SOURCE_SELECT_SQL, TRACE_ROOTS_VIEW_SQL]) {
      expect(sql).not.toContain("coalesce(scope_name");
      expect(sql).not.toContain("JSONExtractString(data, 'http.target')");
      expect(sql).not.toContain("_next/static");
      expect(sql).not.toContain("span_type = 'OPTIONS'");
    }
  });

  test("the trace inbox unions the virtual session root with physical unparented operations", () => {
    expect(TRACE_ROOTS_VIEW_SQL).toContain("FROM analytics_internal.trace_roots FINAL");
    expect(TRACE_ROOTS_VIEW_SQL).toContain("UNION ALL");
    expect(TRACE_ROOTS_VIEW_SQL).toContain(REFRESH_TOKEN_SPAN_SELECT_SQL);
  });

  test("span usage follows the server-derived billing classification", () => {
    const sql = buildSpanWritesMvSql("analytics_internal");
    expect(sql).toContain("billing_item = 'analytics_spans'");
    expect(sql).not.toContain("scope_name IS NULL");
    expect(sql).not.toContain("startsWith(span_type");
  });

  test("trace_roots carries the page-view correlation the inbox groups by", () => {
    expect(names(TRACE_ROOTS_COLUMNS)).toContain("page_view_span_id");
  });

  test("trace_roots reuses the spans column types verbatim", () => {
    // The materialized view inserts straight from spans into trace_roots, and a
    // type mismatch there is rejected at INSERT time — i.e. it breaks ingestion
    // rather than deployment.
    const spansByName = new Map<string, ClickhouseColumn>(SPANS_COLUMNS.map((column) => [column.name, column]));
    for (const column of TRACE_ROOTS_COLUMNS) {
      expect(column).toEqual(spansByName.get(column.name));
    }
  });

  test("selectColumnNames rejects an exclusion that does not exist", () => {
    expect(() => selectColumnNames(SPANS_COLUMNS, ["nonexistent"])).toThrow(/nonexistent/);
  });

  test("the trace_services source SELECT produces the declared columns in order", () => {
    // The backfill runs this SELECT as a positional `INSERT INTO ... SELECT`,
    // so a column added to TRACE_SERVICES_COLUMNS but not here (or in a
    // different spot) would mis-pair or reject the insert at runtime.
    const selectBody = TRACE_SERVICES_SOURCE_SELECT_SQL
      .slice(TRACE_SERVICES_SOURCE_SELECT_SQL.indexOf("SELECT") + "SELECT".length, TRACE_SERVICES_SOURCE_SELECT_SQL.indexOf("FROM analytics_internal.spans"))
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.length > 0)
      // Everything is either `<expression> AS <name>` or a bare column name.
      .map((line) => line.split(/ AS /).at(-1) ?? line);
    expect(selectBody).toEqual(names(TRACE_SERVICES_COLUMNS));
  });
});

describe("error grouping columns on analytics_internal.telemetry", () => {
  test("logs carries the full event shape plus grouping and canonical OTel columns", () => {
    // The log/error row shape is the entire event shape — including `message`,
    // the server-promoted human-readable occurrence text — followed by the
    // grouping, envelope, and OTel columns appended after the event-shaped
    // tenancy/correlation fields.
    expect(names(LOGS_COLUMNS)).toEqual([...names(EVENTS_COLUMNS), ...ERROR_GROUPING_COLUMN_NAMES, ...ERROR_ENVELOPE_COLUMN_NAMES, ...names(OTEL_LOG_COLUMNS)]);
    expect(names(LOGS_COLUMNS)).toContain("message");
    expect(names(EVENTS_COLUMNS).at(-1)).toBe("created_at");

    // The other two telemetry destinations keep the plain event shape. Errors
    // are log-shaped and land in `logs`; nothing writes a grouped occurrence to
    // `events` or `span_events`.
    for (const columns of [EVENTS_COLUMNS, SPAN_EVENTS_COLUMNS]) {
      for (const name of ERROR_GROUPING_COLUMN_NAMES) {
        expect(names(columns)).not.toContain(name);
      }
    }
  });

  test("every grouping column has a DB-side default", () => {
    // Without a constant default, ADD COLUMN over a production-sized `logs`
    // table is a rewrite, and pre-grouping rows would read back NULL — which
    // would force a nullability branch into every "is this occurrence grouped"
    // predicate instead of the single `issue_hash != ''` test.
    for (const column of ERROR_GROUPING_COLUMNS) {
      expect(column.default, `grouping column ${column.name} must be defaulted`).not.toBeUndefined();
    }
  });

  test("error_frames is its own String column rather than a path inside data", () => {
    // `data` is ClickHouse type JSON: one physical subcolumn per distinct path,
    // and the customer's 64 KB budget. ~10 keys x up to 50 frames per error
    // would blow past max_dynamic_paths and degrade the whole logs table.
    const frames = ERROR_GROUPING_COLUMNS.find((column) => column.name === "error_frames");
    expect(frames?.type).toBe("String");
    expect(EVENTS_COLUMNS.find((column) => column.name === "data")?.type).toBe("JSON");
  });

  test("default.errors exposes the grouping columns and default.logs hides exactly them", () => {
    for (const name of ERROR_GROUPING_COLUMN_NAMES) {
      expect(ERRORS_VIEW_SQL).toContain(`\n  ${name}`);
      expect(LOGS_VIEW_SQL).not.toContain(`\n  ${name}`);
    }
    // The public log view exposes the canonical OTel fields in addition to the
    // released event projection; only issue-grouping internals are hidden.
    expect(ERRORS_VIEW_SQL).toContain("WHERE event_type = '$error'");
    expect(LOGS_VIEW_SQL).toContain("WHERE event_type = '$log'");
    // Both read the canonical telemetry table directly. A frozen pre-telemetry
    // `analytics_internal.events` table may still exist on old databases; it is
    // deliberately not part of any view (see the note above EVENTS_VIEW_SQL).
    expect(ERRORS_VIEW_SQL).toContain("FROM analytics_internal.telemetry");
    expect(LOGS_VIEW_SQL).toContain("FROM analytics_internal.telemetry");
    expect(selectColumnNames(LOGS_COLUMNS, ERROR_GROUPING_COLUMN_NAMES)).toEqual([
      ...names(EVENTS_COLUMNS),
      ...ERROR_ENVELOPE_COLUMN_NAMES,
      ...names(OTEL_LOG_COLUMNS),
    ]);
  });

  test("the skip index covers the scalar owning hash, not the diagnostic alias array", () => {
    // Occurrence resolution is always `issue_hash IN (...)`; `issue_hashes` is
    // never filtered on, so indexing it would be pure write amplification.
    expect(LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL).toBe("issue_hash TYPE bloom_filter(0.01) GRANULARITY 4");
    expect(LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL).not.toContain("issue_hashes");
    expect(buildTelemetryCreateTableSql("t")).toContain(`INDEX ${LOGS_ISSUE_HASH_INDEX_NAME} ${LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL}`);
  });
});

describe("canonical telemetry table", () => {
  test("contains the compatible product, error, and OTel column superset", () => {
    expect(names(TELEMETRY_COLUMNS)).toEqual([
      ...names(EVENTS_COLUMNS),
      ...ERROR_GROUPING_COLUMN_NAMES,
      ...ERROR_ENVELOPE_COLUMN_NAMES,
      ...names(OTEL_LOG_COLUMNS),
    ]);
  });
});

describe("issue occurrence rollup", () => {
  const tableSql = buildIssueOccurrenceRollupCreateTableSql("analytics_internal");
  const mvSql = buildIssueOccurrenceRollupMvSql("analytics_internal");

  test("expiry is keyed on bucket_start, and there is no created_at to key it on instead", () => {
    // An AggregatingMergeTree merges every insert sharing the issue key, so a
    // plain non-key `created_at` cannot expire cohorts independently: whichever
    // value survived the merge either keeps the aggregate alive past retention
    // or drops still-live data early. bucket_start is IN the sorting key.
    expect(tableSql).toContain(`TTL toDateTime(bucket_start) + INTERVAL ${TELEMETRY_TTL_DAYS} DAY DELETE`);
    expect(tableSql).not.toContain("created_at");
    expect(tableSql).toContain("ENGINE = AggregatingMergeTree");
    expect(tableSql).toContain("PARTITION BY toYYYYMM(bucket_start)");
  });

  test("service and environment precede issue_hash in the sorting key", () => {
    // Reads are service/environment-filtered; with issue_hash first the key
    // prefix a scan can seek on ends before the filtered columns and prunes
    // nothing.
    expect(tableSql).toContain("ORDER BY (project_id, branch_id, service_name, deployment_environment_name, issue_hash, bucket_start)");
  });

  test("unique users are kept as a mergeable state over Nullable(String)", () => {
    // Summing per-bucket counts double-counts anyone active in more than one
    // bucket or under more than one hash of a merged issue; only uniqMerge is
    // correct. Nullable rather than coalesce(user_id, '') so anonymous
    // occurrences do not each contribute a phantom unique user.
    expect(tableSql).toContain("users_state AggregateFunction(uniq, Nullable(String))");
    expect(mvSql).toContain("uniqState(user_id) AS users_state");
    expect(mvSql).not.toContain("coalesce(user_id");
  });

  test("the materialized view coalesces the nullable service columns", () => {
    // service_name/deployment_environment_name are LowCardinality(Nullable(String))
    // on logs and non-null on the rollup. A type mismatch in a dependent MV is
    // rejected at INSERT time against the SOURCE — it would break all log and
    // error ingestion, not just the rollup.
    for (const column of ["service_name", "deployment_environment_name"] as const) {
      expect(EVENTS_COLUMNS.find((c) => c.name === column)?.type).toBe("LowCardinality(Nullable(String))");
      expect(tableSql).toContain(`${column} LowCardinality(String)`);
      expect(mvSql).toContain(`coalesce(${column}, '') AS ${column}`);
    }
  });

  test("the materialized view reads only grouped $error rows from logs", () => {
    expect(mvSql).toContain("FROM analytics_internal.telemetry");
    expect(mvSql).toContain("WHERE event_type = '$error' AND issue_hash != ''");
    expect(mvSql).toContain("toStartOfHour(event_at) AS bucket_start");
    expect(mvSql).toContain("GROUP BY project_id, branch_id, issue_hash, bucket_start, service_name, deployment_environment_name");
  });

  test("the materialized view's output order matches the target table's column order", () => {
    // A `TO table` materialized view pairs its SELECT with the target
    // positionally, so a reordered SELECT silently mis-pairs same-typed columns.
    const selectBody = mvSql
      .slice(mvSql.indexOf("SELECT") + "SELECT".length, mvSql.indexOf("FROM analytics_internal.telemetry"))
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.length > 0)
      .map((line) => line.split(/ AS /).at(-1) ?? line);
    expect(selectBody).toEqual([
      "project_id", "branch_id", "issue_hash", "bucket_start",
      "service_name", "deployment_environment_name",
      "occurrences", "users_state", "first_seen", "last_seen",
    ]);
  });
});

describe("issues subsystem fingerprint", () => {
  test("responds to a change in either object it owns", () => {
    const current = computeIssuesSubsystemFingerprint();
    expect(current).toMatch(/^[0-9a-f]{32}$/);
    expect(current).not.toBe(computeIssuesSubsystemFingerprint(
      buildIssueOccurrenceRollupCreateTableSql("analytics_internal").replace("INTERVAL 90", "INTERVAL 30"),
    ));
    expect(current).not.toBe(computeIssuesSubsystemFingerprint(
      undefined,
      buildIssueOccurrenceRollupMvSql("analytics_internal").replace("toStartOfHour", "toStartOfDay"),
    ));
    // Independent of the spans one: rebuilding one subsystem must never drop
    // the other's tables.
    expect(current).not.toBe(computeSpansSubsystemFingerprint());
  });

  test("does NOT cover the logs grouping columns", () => {
    // A fingerprint mismatch DROPS everything it covers. The rollup is a pure
    // aggregate of logs and can be rebuilt; the grouping columns hold
    // non-derivable per-occurrence data computed once at ingest. Widening this
    // fingerprint to LOGS_COLUMNS would turn "we renamed a rollup column" into
    // "we deleted every customer error occurrence".
    const fingerprintInputs = [
      buildIssueOccurrenceRollupCreateTableSql("analytics_internal"),
      buildIssueOccurrenceRollupMvSql("analytics_internal"),
    ].join("\n");
    // `issue_hash` legitimately appears (it is a rollup key). Every OTHER
    // grouping column exists only on `logs` and must never leak in here — their
    // presence is the signature of someone hashing the logs declaration.
    for (const name of ERROR_GROUPING_COLUMN_NAMES.filter((n) => n !== "issue_hash")) {
      expect(fingerprintInputs, `${name} must not feed the issues fingerprint`).not.toContain(name);
    }
    // Adding a grouping column to the telemetry table changes its upgrade path
    // and nothing else.
    const baseline = computeIssuesSubsystemFingerprint();
    const widenedLogs: ClickhouseColumn[] = [...LOGS_COLUMNS, { name: "issue_platform", type: "LowCardinality(String)", default: "''" }];
    expect(buildColumnUpgradeSql("analytics_internal.telemetry", widenedLogs)).toContain("issue_platform");
    expect(computeIssuesSubsystemFingerprint()).toBe(baseline);
  });
});

describe("telemetry table physical layout", () => {
  test("spans are partitioned by started_at, not ingestion time", () => {
    // ReplacingMergeTree dedup never crosses partitions; created_at changes on
    // every re-upsert of the same span, started_at does not.
    const sql = buildSpansCreateTableSql("analytics_internal.spans");
    expect(sql).toContain("PARTITION BY toYYYYMM(started_at)");
    expect(sql).toContain("ENGINE ReplacingMergeTree(version)");
    expect(sql).toContain(`SETTINGS non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`);
  });

  test("every physical batch destination enables non-replicated insert deduplication", () => {
    expect(TELEMETRY_INSERT_TABLES.map(buildTelemetryInsertDeduplicationSettingSql)).toEqual([
      `ALTER TABLE analytics_internal.telemetry MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
      `ALTER TABLE analytics_internal.spans MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
      `ALTER TABLE analytics_internal.span_events MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
      `ALTER TABLE analytics_internal.span_links MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
      `ALTER TABLE analytics_internal.metrics MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
    ]);
  });

  test("native OTLP metrics preserve point identity across retries", () => {
    const sql = buildOtelMetricsCreateTableSql("analytics_internal.metrics");
    expect(names(OTEL_METRICS_COLUMNS)).toContain("metric_name");
    expect(names(OTEL_METRICS_COLUMNS)).toContain("data_point");
    expect(names(OTEL_METRICS_COLUMNS)).toContain("exemplar_trace_id");
    expect(sql).toContain("ENGINE ReplacingMergeTree(created_at)");
    expect(sql).toContain("ORDER BY (project_id, branch_id, point_id)");
    expect(sql).toContain("PARTITION BY toYYYYMM(toDateTime(time_unix_nano / 1000000000))");
    expect(sql).toContain(`TTL toDateTime(created_at) + INTERVAL ${TELEMETRY_TTL_DAYS} DAY DELETE`);
  });

  test("span_links dedupe retried exports via ReplacingMergeTree over the full identity key", () => {
    const sql = buildSpanLinksCreateTableSql("analytics_internal.span_links");
    expect(sql).toContain("ENGINE ReplacingMergeTree(created_at)");
    expect(sql).toContain("ORDER BY (project_id, branch_id, trace_id, owner_span_id, linked_project_id, linked_branch_id, linked_trace_id, linked_span_id)");
    expect(sql).toContain("linked_project_id String DEFAULT project_id");
    expect(sql).toContain("linked_branch_id String DEFAULT branch_id");
  });

  test("span_events converge retried OTLP exports on their canonical event identity", () => {
    const sql = buildSpanEventsCreateTableSql("analytics_internal.span_events");
    expect(sql).toContain("ENGINE ReplacingMergeTree");
    expect(sql).toContain("ifNull(trace_id, ''), ifNull(span_id, ''), event_ordinal, event_at, event_type");
    // The open-marker snapshot and the end-write re-insert the same events
    // under different dedup tokens; without FINAL the public projection shows
    // them twice until a background merge happens to run.
    expect(SPAN_EVENTS_VIEW_SQL).toContain("FROM analytics_internal.span_events FINAL");
  });

  test("telemetry tables declare the retention TTL in their CREATE statements", () => {
    expect(buildSpansCreateTableSql("t")).toContain(`TTL toDateTime(created_at) + INTERVAL ${TELEMETRY_TTL_DAYS} DAY DELETE`);
    expect(buildSpanLinksCreateTableSql("t")).toContain(`TTL toDateTime(created_at) + INTERVAL ${TELEMETRY_TTL_DAYS} DAY DELETE`);
    // The derived read models must not outlive the spans they are derived from.
    expect(buildTraceRootsCreateTableSql("t")).toContain(`TTL toDateTime(created_at) + INTERVAL ${TELEMETRY_TTL_DAYS} DAY DELETE`);
    expect(buildTraceServicesCreateTableSql("t")).toContain(`TTL toDateTime(created_at) + INTERVAL ${TELEMETRY_TTL_DAYS} DAY DELETE`);
  });

  test("the billing ledger outlives telemetry retention", () => {
    // span_writes must stay auditable for every billing period it can be
    // disputed against; telemetry data has no such requirement.
    expect(SPAN_WRITES_TTL_DAYS).toBeGreaterThan(TELEMETRY_TTL_DAYS);
  });

  test("the billing view trusts only the authenticated ingestion classification", () => {
    // The exact WHERE clause is billing-critical: producer is stamped by the
    // route and billing_item is derived there from the accepted signal rather
    // than inferred later from user-controlled names or OTel scopes.
    expect(buildSpanWritesMvSql("analytics_internal")).toContain("WHERE producer = 'sdk' AND billing_item = 'analytics_spans'");
  });
});

// ─── Integration tests against the local ClickHouse ─────────────────
//
// These exercise the upgrade helpers against a real server (the docker-compose
// dependency container) inside a throwaway database, because the behaviors
// under test — EXCHANGE TABLES atomic swaps, materialized views surviving the
// swap, FINAL dedup semantics across partitions, TTL/index metadata probes —
// cannot be meaningfully simulated on SQL strings. They fail loudly if
// ClickHouse is unreachable (run `pnpm restart-deps` to bring it up).
describe("clickhouse upgrade helpers (integration)", () => {
  const testDatabase = `analytics_migrations_test_${randomUUID().replaceAll("-", "")}`;
  let client: ClickHouseClient;

  beforeAll(async () => {
    client = getClickhouseAdminClient();
    await client.command({ query: `CREATE DATABASE ${testDatabase}` });
  });

  afterAll(async () => {
    await client.command({ query: `DROP DATABASE IF EXISTS ${testDatabase}` });
    await client.close();
  });

  async function getTableLayout(table: string): Promise<{ engine: string, partition_key: string, engine_full: string }> {
    const resultSet = await client.query({
      query: "SELECT engine, partition_key, engine_full FROM system.tables WHERE database = {database:String} AND name = {table:String}",
      query_params: { database: testDatabase, table },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ engine: string, partition_key: string, engine_full: string }>();
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  async function countRows(table: string, options: { final?: boolean } = {}): Promise<number> {
    const resultSet = await client.query({
      query: `SELECT count() AS count FROM ${testDatabase}.${table}${options.final ? " FINAL" : ""}`,
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ count: string }>();
    return Number(rows[0].count);
  }

  async function countMutations(table: string): Promise<number> {
    const resultSet = await client.query({
      query: "SELECT count() AS count FROM system.mutations WHERE database = {database:String} AND table = {table:String}",
      query_params: { database: testDatabase, table },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ count: string }>();
    return Number(rows[0].count);
  }

  async function countActivePartitions(table: string): Promise<number> {
    const resultSet = await client.query({
      query: "SELECT countDistinct(partition) AS count FROM system.parts WHERE database = {database:String} AND table = {table:String} AND active",
      query_params: { database: testDatabase, table },
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ count: string }>();
    return Number(rows[0].count);
  }

  const toClickhouseDateTime = (date: Date) => date.toISOString().replace("T", " ").replace("Z", "");

  async function withThrowawayDatabase<T>(callback: (database: string) => Promise<T>): Promise<T> {
    const database = `clickhouse_migrations_test_${randomUUID().replaceAll("-", "")}`;
    await client.command({ query: `CREATE DATABASE ${database}` });
    try {
      return await callback(database);
    } finally {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }
  }

  async function countRowsIn(database: string, table: string): Promise<number> {
    const resultSet = await client.query({
      query: `SELECT count() AS count FROM ${database}.${table}`,
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ count: string }>();
    return Number(rows[0].count);
  }

  test("the span_writes billing view meters only classified SDK spans", async () => {
    await client.command({ query: buildSpansCreateTableSql(`${testDatabase}.spans`) });
    await client.command({ query: buildSpanWritesCreateTableSql(testDatabase) });
    await client.command({ query: buildSpanWritesMvSql(testDatabase) });

    const startedAt = toClickhouseDateTime(new Date());
    await client.command({
      query: `
        INSERT INTO ${testDatabase}.spans (trace_id, span_id, span_type, billing_item, producer, started_at, project_id, branch_id, version) VALUES
        ('trace-b1', 'span-b1', 'checkout-flow', 'analytics_spans', 'sdk', '${startedAt}', 'billed-project', 'b', 1),
        ('trace-b2', 'span-b2', '$page-view', NULL, 'sdk', '${startedAt}', 'billed-project', 'b', 1),
        ('trace-b3', 'span-b3', 'handler', NULL, 'hexclave-backend', '${startedAt}', 'billed-project', 'b', 1),
        ('trace-b4', 'span-b4', 'spoofed', 'analytics_spans', 'hexclave-backend', '${startedAt}', 'billed-project', 'b', 1)
      `,
    });

    const resultSet = await client.query({
      query: `SELECT project_id FROM ${testDatabase}.span_writes`,
      format: "JSONEachRow",
    });
    const ledgerRows = await resultSet.json<{ project_id: string }>();
    // Exactly one billable write: both the SDK producer and the server-derived
    // item classification are required.
    expect(ledgerRows).toEqual([{ project_id: "billed-project" }]);
  });

  test("ensureTableTtl applies the retention TTL exactly once, and re-applies on a changed retention", async () => {
    const table = "ttl_probe";
    await client.command({
      query: `CREATE TABLE ${testDatabase}.${table} (id String, created_at DateTime64(3, 'UTC') DEFAULT now64(3)) ENGINE MergeTree ORDER BY id`,
    });

    await ensureTableTtl(client, { database: testDatabase, table, ttlDays: TELEMETRY_TTL_DAYS });
    // ClickHouse normalizes `INTERVAL n DAY` to `toIntervalDay(n)` in metadata;
    // ensureTableTtl's idempotency probe relies on exactly this form.
    expect((await getTableLayout(table)).engine_full).toContain(`toDateTime(created_at) + toIntervalDay(${TELEMETRY_TTL_DAYS})`);

    const mutationsAfterFirstRun = await countMutations(table);
    await ensureTableTtl(client, { database: testDatabase, table, ttlDays: TELEMETRY_TTL_DAYS });
    expect(await countMutations(table)).toBe(mutationsAfterFirstRun);

    // Changing the retention constant must re-trigger exactly one MODIFY TTL.
    await ensureTableTtl(client, { database: testDatabase, table, ttlDays: SPAN_WRITES_TTL_DAYS });
    expect((await getTableLayout(table)).engine_full).toContain(`toDateTime(created_at) + toIntervalDay(${SPAN_WRITES_TTL_DAYS})`);
  });

  test("ensureTableTtl recognizes the TTL declared by the derived read models' CREATE statements", async () => {
    // Fresh databases create trace_roots/trace_services with the TTL clause
    // already in place; ensureTableTtl must see it as current (ClickHouse
    // normalizes `INTERVAL n DAY` to `toIntervalDay(n)` in metadata) and not
    // schedule a MODIFY TTL mutation on every boot.
    for (const [table, buildCreateSql] of [
      ["trace_roots", buildTraceRootsCreateTableSql],
      ["trace_services", buildTraceServicesCreateTableSql],
    ] as const) {
      await client.command({ query: buildCreateSql(`${testDatabase}.${table}`) });
      await ensureTableTtl(client, { database: testDatabase, table, ttlDays: TELEMETRY_TTL_DAYS });
      expect((await getTableLayout(table)).engine_full).toContain(`toDateTime(created_at) + toIntervalDay(${TELEMETRY_TTL_DAYS})`);
      expect(await countMutations(table)).toBe(0);
    }
  });

  test("a pre-TTL trace_services table gains created_at and the TTL without losing rows", async () => {
    const table = "trace_services_upgrade_probe";
    // The vintage that predates both the created_at column and the TTL clause.
    await client.command({
      query: `
        CREATE TABLE ${testDatabase}.${table} (
            project_id String,
            branch_id String,
            trace_id String,
            service_namespace String,
            service_name String,
            version UInt64
        )
        ENGINE ReplacingMergeTree(version)
        ORDER BY (project_id, branch_id, service_namespace, service_name, trace_id)
      `,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.${table} (project_id, branch_id, trace_id, service_namespace, service_name, version) VALUES ('p', 'b', 'trace-1', '', 'checkout-api', 1)`,
    });

    await client.command({ query: buildColumnUpgradeSql(`${testDatabase}.${table}`, TRACE_SERVICES_COLUMNS) });
    await ensureTableTtl(client, { database: testDatabase, table, ttlDays: TELEMETRY_TTL_DAYS });

    expect((await getTableLayout(table)).engine_full).toContain(`toDateTime(created_at) + toIntervalDay(${TELEMETRY_TTL_DAYS})`);
    // The pre-existing row's created_at materializes as the mutation time (the
    // ADD COLUMN default is non-materialized now64(3)), i.e. it gets a fresh
    // retention lease instead of being dropped by the TTL mutation.
    expect(await countRows(table)).toBe(1);
    const resultSet = await client.query({
      query: `SELECT created_at FROM ${testDatabase}.${table}`,
      format: "JSONEachRow",
    });
    const rows = await resultSet.json<{ created_at: string }>();
    const createdAt = new Date(`${rows[0].created_at.replace(" ", "T")}Z`);
    expect(Math.abs(createdAt.getTime() - Date.now())).toBeLessThan(5 * 60 * 1000);
  });

  test("ensureSkipIndex refuses unbounded historical materialization before changing metadata", async () => {
    const table = "skip_index_probe";
    await client.command({
      query: `CREATE TABLE ${testDatabase}.${table} (project_id String, event_type LowCardinality(String)) ENGINE MergeTree ORDER BY project_id`,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.${table} (project_id, event_type) VALUES ('p', '$log')`,
    });

    const options = { database: testDatabase, table, indexName: EVENTS_EVENT_TYPE_INDEX_NAME, indexDefinitionSql: EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL, materializeHistoricalParts: true };
    await expect(ensureSkipIndex(client, options)).rejects.toThrow(/materialize closed partitions separately/);

    const resultSet = await client.query({
      query: "SELECT count() AS count FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String} AND name = {indexName:String}",
      query_params: { database: testDatabase, table, indexName: EVENTS_EVENT_TYPE_INDEX_NAME },
      format: "JSONEachRow",
    });
    expect(Number((await resultSet.json<{ count: number | string }>())[0].count)).toBe(0);
    expect(await countMutations(table)).toBe(0);
  });

  test("ensureSkipIndex can skip historical materialization for a freshly-defaulted column", async () => {
    const table = "skip_index_no_materialize_probe";
    await client.command({
      query: `CREATE TABLE ${testDatabase}.${table} (project_id String, issue_hash String DEFAULT '') ENGINE MergeTree ORDER BY project_id`,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.${table} (project_id) VALUES ('p')`,
    });

    await ensureSkipIndex(client, {
      database: testDatabase,
      table,
      indexName: LOGS_ISSUE_HASH_INDEX_NAME,
      indexDefinitionSql: LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL,
      materializeHistoricalParts: false,
    });

    const indexSet = await client.query({
      query: "SELECT name FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String}",
      query_params: { database: testDatabase, table },
      format: "JSONEachRow",
    });
    expect(await indexSet.json<{ name: string }>()).toEqual([{ name: LOGS_ISSUE_HASH_INDEX_NAME }]);
    // The index exists for future parts, but no mutation was scheduled over the
    // historical ones — which is the whole point, since every pre-existing row
    // holds the same '' default and the bloom filter would prune nothing.
    expect(await countMutations(table)).toBe(0);
  });

  test("derived span backfills checkpoint physical partitions and never use target emptiness", async () => {
    await withThrowawayDatabase(async (database) => {
      await client.command({
        query: `
          CREATE TABLE ${database}.spans (
            trace_id String,
            started_at DateTime64(3, 'UTC'),
            created_at DateTime64(3, 'UTC'),
            version UInt64
          )
          ENGINE ReplacingMergeTree(version)
          PARTITION BY toYYYYMM(started_at)
          ORDER BY trace_id
        `,
      });
      await client.command({
        query: `
          CREATE TABLE ${database}.derived_probe (
            trace_id String,
            started_at DateTime64(3, 'UTC'),
            created_at DateTime64(3, 'UTC'),
            version UInt64
          )
          ENGINE ReplacingMergeTree(version)
          PARTITION BY toYYYYMM(started_at)
          ORDER BY trace_id
        `,
      });
      await client.command({
        query: `
          INSERT INTO ${database}.spans VALUES
            ('old-a', '2026-06-01 00:00:00.000', '2026-06-01 00:00:01.000', 1),
            ('old-b', '2026-07-01 00:00:00.000', '2026-07-01 00:00:01.000', 1)
        `,
      });
      // Simulates a concurrent MV write. The old count-based implementation
      // saw this row and skipped all historical spans.
      await client.command({
        query: `INSERT INTO ${database}.derived_probe VALUES ('live', '2026-08-01 00:00:00.000', '2026-08-01 00:00:01.000', 1)`,
      });

      const columns = [
        { name: "trace_id", type: "String" },
        { name: "created_at", type: "DateTime64(3, 'UTC')" },
        { name: "version", type: "UInt64" },
      ] as const satisfies readonly ClickhouseColumn[];
      // Intentionally does not project started_at, matching trace_services.
      // Partition pruning must be pushed into the source relation rather than
      // applied around this projection.
      const selectSql = `SELECT trace_id, created_at, version FROM ${database}.spans`;
      await backfillDerivedSpanTable(client, { database, table: "derived_probe", selectSql, targetColumns: columns });
      expect(await countRowsIn(database, "derived_probe")).toBe(3);
      expect(await countRowsIn(database, "derived_span_backfill_state")).toBe(3);

      // Checkpoints make a restart an O(number of active partitions) metadata
      // probe and prevent a second INSERT of either historical partition.
      await backfillDerivedSpanTable(client, { database, table: "derived_probe", selectSql, targetColumns: columns });
      expect(await countRowsIn(database, "derived_probe")).toBe(3);
      expect(await countRowsIn(database, "derived_span_backfill_state")).toBe(3);
    });
  });

  test("the rollup materialized view's output types match its target table exactly", async () => {
    await client.command({ query: buildTelemetryCreateTableSql(`${testDatabase}.telemetry`) });
    await client.command({ query: buildIssueOccurrenceRollupCreateTableSql(testDatabase) });
    await client.command({ query: buildIssueOccurrenceRollupMvSql(testDatabase) });

    const columnTypes = async (table: string) => {
      const resultSet = await client.query({
        query: "SELECT name, type FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position",
        query_params: { database: testDatabase, table },
        format: "JSONEachRow",
      });
      return await resultSet.json<{ name: string, type: string }>();
    };
    // `SimpleAggregateFunction(f, T)` accepts a plain `T` from the SELECT — that
    // is exactly what makes it "simple". Unwrap it so the comparison asserts the
    // real ClickHouse compatibility rule rather than a spelling difference; the
    // genuinely strict cases (`bucket_start DateTime('UTC')` from
    // toStartOfHour, `LowCardinality(String)` from coalesce, and the `uniq`
    // state's Nullable(String) argument) are compared verbatim.
    const unwrapSimpleAggregate = (type: string) => type.replace(/^SimpleAggregateFunction\([^,]+, (.*)\)$/, "$1");

    const target = await columnTypes("issue_occurrence_rollup");
    const view = await columnTypes("issue_occurrence_rollup_mv");
    expect(view.map((column) => column.name)).toEqual(target.map((column) => column.name));
    expect(view.map((column) => column.type)).toEqual(target.map((column) => unwrapSimpleAggregate(column.type)));
    // The one that cannot be papered over by an implicit cast, and the reason
    // this file exists: a state-type mismatch fails at ingestion, not deploy.
    expect(view.find((column) => column.name === "users_state")?.type).toBe("AggregateFunction(uniq, Nullable(String))");
  });

  test("the rollup fills forward from $error inserts without breaking the source insert", async () => {
    // The table/MV are created by the type-match test above; both `IF NOT
    // EXISTS`, so re-issuing them keeps this test independent of ordering.
    await client.command({ query: buildTelemetryCreateTableSql(`${testDatabase}.telemetry`) });
    await client.command({ query: buildIssueOccurrenceRollupCreateTableSql(testDatabase) });
    await client.command({ query: buildIssueOccurrenceRollupMvSql(testDatabase) });

    await client.command({
      query: `
        INSERT INTO ${testDatabase}.telemetry (event_type, event_at, data, project_id, branch_id, user_id, service_name, deployment_environment_name, issue_hash) VALUES
        ('$error', now64(3), '{}', 'roll', 'b', 'u1',  'api',  'production', 'hash-a'),
        ('$error', now64(3), '{}', 'roll', 'b', NULL,  'api',  'production', 'hash-a'),
        ('$error', now64(3), '{}', 'roll', 'b', 'u2',  'api',  'production', 'hash-a'),
        ('$error', now64(3), '{}', 'roll', 'b', 'u1',  NULL,   NULL,         'hash-b'),
        ('$error', now64(3), '{}', 'roll', 'b', 'u3',  'api',  'production', ''),
        ('$log',   now64(3), '{}', 'roll', 'b', 'u4',  'api',  'production', '')
      `,
    });

    const resultSet = await client.query({
      query: `
        SELECT issue_hash, service_name, deployment_environment_name, sum(occurrences) AS occurrences, uniqMerge(users_state) AS users
        FROM ${testDatabase}.issue_occurrence_rollup
        WHERE project_id = 'roll'
        GROUP BY issue_hash, service_name, deployment_environment_name
        ORDER BY issue_hash
      `,
      format: "JSONEachRow",
    });
    const rollupRows = await resultSet.json<{ issue_hash: string, service_name: string, deployment_environment_name: string, occurrences: number | string, users: number | string }>();
    expect(rollupRows.map((row) => ({ ...row, occurrences: Number(row.occurrences), users: Number(row.users) }))).toEqual([
      // 3 occurrences, but only 2 unique users: the anonymous one contributes
      // NULL, which `uniq` over Nullable(String) does not count. The documented
      // `coalesce(user_id, '')` fallback would have reported 3 here.
      { issue_hash: "hash-a", service_name: "api", deployment_environment_name: "production", occurrences: 3, users: 2 },
      // Nullable service/environment coalesce to '' rather than failing the
      // source insert.
      { issue_hash: "hash-b", service_name: "", deployment_environment_name: "", occurrences: 1, users: 1 },
    ]);
    // Ungrouped ($error with an empty hash) and non-error rows never reach the
    // rollup, so pre-grouping history simply ages out instead of needing a
    // backfill.
    const ungrouped = await client.query({
      query: `SELECT count() AS count FROM ${testDatabase}.issue_occurrence_rollup WHERE project_id = 'roll' AND issue_hash = ''`,
      format: "JSONEachRow",
    });
    expect(Number((await ungrouped.json<{ count: string }>())[0].count)).toBe(0);
  });

  test("the rollup expires on bucket_start, so late arrivals never extend or shorten a bucket's lease", async () => {
    const table = "issue_rollup_ttl_probe";
    await client.command({ query: buildIssueOccurrenceRollupCreateTableSql(testDatabase).replace("issue_occurrence_rollup", table) });

    const insertBucket = async (issueHash: string, daysAgo: number, userId: string) => {
      await client.command({
        query: `
          INSERT INTO ${testDatabase}.${table}
          SELECT 'ttl', 'b', '${issueHash}', toStartOfHour(now() - INTERVAL ${daysAgo} DAY), 'api', 'production',
                 1, uniqState(CAST('${userId}', 'Nullable(String)')), now64(3), now64(3)
        `,
      });
    };
    // MATERIALIZE TTL rather than OPTIMIZE FINAL: it is a mutation, so it is
    // synchronous under mutations_sync and is not throttled by
    // merge_with_ttl_timeout. Without it the assertions race a background merge.
    const applyTtl = async () => {
      await client.command({ query: `ALTER TABLE ${testDatabase}.${table} MATERIALIZE TTL`, clickhouse_settings: { mutations_sync: "2" } });
    };
    const bucketsByHash = async () => {
      const resultSet = await client.query({
        query: `SELECT issue_hash, toString(bucket_start) AS bucket_start, sum(occurrences) AS occurrences FROM ${testDatabase}.${table} GROUP BY issue_hash, bucket_start ORDER BY issue_hash`,
        format: "JSONEachRow",
      });
      const rows = await resultSet.json<{ issue_hash: string, bucket_start: string, occurrences: number | string }>();
      return rows.map((row) => ({ ...row, occurrences: Number(row.occurrences) }));
    };

    await insertBucket("just-expired", 91, "u1");
    await insertBucket("still-live", 89, "u1");
    await applyTtl();
    // 91 days > the 90-day retention keyed on bucket_start; 89 does not.
    expect((await bucketsByHash()).map((row) => row.issue_hash)).toEqual(["still-live"]);

    // A late-arriving occurrence for the 89-day-old bucket merges into the same
    // aggregate. Its own arrival time is nowhere in the table, so it can neither
    // grant the bucket a fresh 90-day lease nor pull the expiry forward — which
    // is precisely what a `created_at` column would have done.
    const liveBucketStart = (await bucketsByHash())[0].bucket_start;
    await insertBucket("still-live", 89, "u2");
    await applyTtl();
    expect(await bucketsByHash()).toEqual([
      { issue_hash: "still-live", bucket_start: liveBucketStart, occurrences: 2 },
    ]);

    // And a late arrival for an already-expired bucket does not resurrect it.
    await insertBucket("just-expired", 91, "u3");
    await applyTtl();
    expect((await bucketsByHash()).map((row) => row.issue_hash)).toEqual(["still-live"]);
  });
});
