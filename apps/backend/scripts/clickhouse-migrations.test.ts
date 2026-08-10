import { getClickhouseAdminClient, type ClickHouseClient } from "@/lib/clickhouse";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ERRORS_VIEW_SQL,
  ERROR_ENVELOPE_COLUMN_NAMES,
  ERROR_GROUPING_COLUMNS,
  ERROR_GROUPING_COLUMN_NAMES,
  EVENTS_COLUMNS,
  EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL,
  EVENTS_EVENT_TYPE_INDEX_NAME,
  EVENTS_LEGACY_COLUMNS_TO_DROP,
  LOGS_COLUMNS,
  LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL,
  LOGS_ISSUE_HASH_INDEX_NAME,
  LOGS_VIEW_SQL,
  REFRESH_TOKEN_SPAN_SELECT_ALIASES,
  REFRESH_TOKEN_SPAN_SELECT_SQL,
  SPANS_COLUMNS,
  SPANS_TRACE_MODEL_VERSION,
  SPANS_VIEW_SQL,
  SPAN_LINKS_COLUMNS,
  SPAN_EVENTS_COLUMNS,
  SPAN_WRITES_TTL_DAYS,
  TELEMETRY_INSERT_DEDUPLICATION_WINDOW,
  TELEMETRY_INSERT_TABLES,
  TELEMETRY_TTL_DAYS,
  TRACE_ROOTS_COLUMNS,
  TRACE_ROOTS_SOURCE_SELECT_SQL,
  TRACE_ROOTS_VIEW_SQL,
  TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL,
  TRACE_SERVICES_COLUMNS,
  TRACE_SERVICES_SOURCE_SELECT_SQL,
  buildColumnUpgradeSql,
  computeIssuesSubsystemFingerprint,
  computeSpansSubsystemFingerprint,
  buildEventsLegacyCleanupSql,
  buildIssueOccurrenceRollupCreateTableSql,
  buildIssueOccurrenceRollupMvSql,
  buildLogsCreateTableSql,
  buildSpanLinksCreateTableSql,
  buildSpanWritesCreateTableSql,
  buildSpanWritesMvSql,
  buildSpansCreateTableSql,
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
  test("changes when the semantic trace model changes, even if the physical schema does not", () => {
    const current = computeSpansSubsystemFingerprint();
    expect(current).toMatch(/^[0-9a-f]{32}$/);
    expect(current).toBe(computeSpansSubsystemFingerprint(SPANS_TRACE_MODEL_VERSION));
    expect(current).not.toBe(computeSpansSubsystemFingerprint("legacy-session-trace"));
  });
});

describe("derived read models", () => {
  test("the trace inbox is fed by the scalar-parent root test", () => {
    // This predicate is the ONLY definition of "trace root" in the system, and the
    // materialized view fires on INSERT — so if it ever references a column that
    // does not exist, span ingestion breaks rather than deployment.
    expect(TRACE_ROOTS_SOURCE_SELECT_SQL).toContain("WHERE parent_span_id IS NULL");
  });

  test("the trace inbox does not promote an orphaned client bridge above its session root", () => {
    expect(TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL).toContain("span_type != '$http-client'");
  });

  test("the trace inbox excludes detached Next lifecycle fragments without rewriting their ancestry", () => {
    expect(TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL).toContain("coalesce(scope_name, '') = 'next.js'");
    expect(TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL).toContain("kind = 'internal'");
    expect(TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL).toContain("span_type = 'OPTIONS'");
    expect(TRACE_ROOTS_SOURCE_SELECT_SQL).toContain(TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL);
    // Existing pre-release tables already contain these rows, so the public
    // view must enforce the policy as well as the materialized-view source.
    expect(TRACE_ROOTS_VIEW_SQL).toContain(TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL);
  });

  test("the trace inbox unions the virtual session root with physical unparented operations", () => {
    expect(TRACE_ROOTS_VIEW_SQL).toContain("FROM analytics_internal.trace_roots FINAL");
    expect(TRACE_ROOTS_VIEW_SQL).toContain("UNION ALL");
    expect(TRACE_ROOTS_VIEW_SQL).toContain(REFRESH_TOKEN_SPAN_SELECT_SQL);
  });

  test("span usage excludes auto-instrumented operation names by scope", () => {
    const sql = buildSpanWritesMvSql("analytics_internal");
    expect(sql).toContain("scope_name IS NULL");
    expect(sql).toContain("NOT startsWith(span_type, '$')");
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

describe("error grouping columns on analytics_internal.logs", () => {
  test("logs carries the grouping and envelope columns appended after created_at, and nothing else does", () => {
    // Appended (not interleaved) is the whole reason a table grown by
    // buildColumnUpgradeSql lands on the same physical order as a fresh one —
    // each ADD COLUMN names its predecessor, and `created_at` is the last
    // EVENTS_COLUMNS entry. Asserted end-to-end against a real server below.
    expect(names(LOGS_COLUMNS)).toEqual([
      ...names(EVENTS_COLUMNS),
      ...ERROR_GROUPING_COLUMN_NAMES,
      ...ERROR_ENVELOPE_COLUMN_NAMES,
    ]);
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
    // The two views must otherwise stay identical in shape — the difference is
    // the grouping columns and the event_type predicate, nothing else. The
    // envelope column is public on both: it is the error payload the issue API
    // reads back, not an issue-grouping internal.
    expect(ERRORS_VIEW_SQL).toContain("WHERE event_type = '$error'");
    expect(LOGS_VIEW_SQL).toContain("WHERE event_type = '$log'");
    expect(selectColumnNames(LOGS_COLUMNS, ERROR_GROUPING_COLUMN_NAMES)).toEqual([
      ...names(EVENTS_COLUMNS),
      ...ERROR_ENVELOPE_COLUMN_NAMES,
    ]);
  });

  test("the skip index covers the scalar owning hash, not the diagnostic alias array", () => {
    // Occurrence resolution is always `issue_hash IN (...)`; `issue_hashes` is
    // never filtered on, so indexing it would be pure write amplification.
    expect(LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL).toBe("issue_hash TYPE bloom_filter(0.01) GRANULARITY 4");
    expect(LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL).not.toContain("issue_hashes");
    expect(buildLogsCreateTableSql("t")).toContain(`INDEX ${LOGS_ISSUE_HASH_INDEX_NAME} ${LOGS_ISSUE_HASH_INDEX_DEFINITION_SQL}`);
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
    expect(mvSql).toContain("FROM analytics_internal.logs");
    expect(mvSql).toContain("WHERE event_type = '$error' AND issue_hash != ''");
    expect(mvSql).toContain("toStartOfHour(event_at) AS bucket_start");
    expect(mvSql).toContain("GROUP BY project_id, branch_id, issue_hash, bucket_start, service_name, deployment_environment_name");
  });

  test("the materialized view's output order matches the target table's column order", () => {
    // A `TO table` materialized view pairs its SELECT with the target
    // positionally, so a reordered SELECT silently mis-pairs same-typed columns.
    const selectBody = mvSql
      .slice(mvSql.indexOf("SELECT") + "SELECT".length, mvSql.indexOf("FROM analytics_internal.logs"))
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
    // Adding a grouping column to logs changes the logs upgrade path and
    // nothing else.
    const baseline = computeIssuesSubsystemFingerprint();
    const widenedLogs: ClickhouseColumn[] = [...LOGS_COLUMNS, { name: "issue_platform", type: "LowCardinality(String)", default: "''" }];
    expect(buildColumnUpgradeSql("analytics_internal.logs", widenedLogs)).toContain("issue_platform");
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
      `ALTER TABLE analytics_internal.events MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
      `ALTER TABLE analytics_internal.logs MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
      `ALTER TABLE analytics_internal.spans MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`,
    ]);
  });

  test("span_links dedupe retried exports via ReplacingMergeTree over the full identity key", () => {
    const sql = buildSpanLinksCreateTableSql("analytics_internal.span_links");
    expect(sql).toContain("ENGINE ReplacingMergeTree(created_at)");
    expect(sql).toContain("ORDER BY (project_id, branch_id, trace_id, owner_span_id, linked_project_id, linked_branch_id, linked_trace_id, linked_span_id)");
    expect(sql).toContain("linked_project_id String DEFAULT project_id");
    expect(sql).toContain("linked_branch_id String DEFAULT branch_id");
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

  test("the billing view zero-rates auto-instrumented and system spans", () => {
    // The exact WHERE clause is billing-critical: dropping the producer
    // condition would meter Hexclave's own self-instrumentation writes against
    // the customer, dropping scope_name would meter auto-instrumented library
    // work, and dropping the $-prefix condition would meter free system
    // autocapture spans. Also covered end-to-end by the integration test below.
    expect(buildSpanWritesMvSql("analytics_internal")).toContain("WHERE producer = 'sdk' AND scope_name IS NULL AND NOT startsWith(span_type, '$')");
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

  async function getColumnNames(table: string): Promise<string[]> {
    const resultSet = await client.query({
      query: "SELECT name FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position",
      query_params: { database: testDatabase, table },
      format: "JSONEachRow",
    });
    return (await resultSet.json<{ name: string }>()).map((row) => row.name);
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


  test("the span_writes billing view meters only non-$ SDK spans", async () => {
    await client.command({ query: buildSpansCreateTableSql(`${testDatabase}.spans`) });
    await client.command({ query: buildSpanWritesCreateTableSql(testDatabase) });
    await client.command({ query: buildSpanWritesMvSql(testDatabase) });

    const startedAt = toClickhouseDateTime(new Date());
    await client.command({
      query: `
        INSERT INTO ${testDatabase}.spans (trace_id, span_id, span_type, producer, started_at, project_id, branch_id, version) VALUES
        ('trace-b1', 'span-b1', 'checkout-flow', 'sdk', '${startedAt}', 'billed-project', 'b', 1),
        ('trace-b2', 'span-b2', '$page-view', 'sdk', '${startedAt}', 'billed-project', 'b', 1),
        ('trace-b3', 'span-b3', 'handler', 'hexclave-backend', '${startedAt}', 'billed-project', 'b', 1)
      `,
    });

    const resultSet = await client.query({
      query: `SELECT project_id FROM ${testDatabase}.span_writes`,
      format: "JSONEachRow",
    });
    const ledgerRows = await resultSet.json<{ project_id: string }>();
    // Exactly one billable write: the custom SDK span. The $-prefixed system
    // span and the backend self-instrumentation span are zero-rated.
    expect(ledgerRows).toEqual([{ project_id: "billed-project" }]);
  });

  test("the events legacy cleanup drops the retired columns and the idx_source index", async () => {
    const table = "events_cleanup_probe";
    // A branch-vintage events table: retired log/tracing columns plus the old
    // source skip index (which must be dropped before its column can be).
    await client.command({
      query: `
        CREATE TABLE ${testDatabase}.${table} (
            event_type LowCardinality(String),
            event_at DateTime64(3, 'UTC'),
            body String DEFAULT '',
            severity_text LowCardinality(String) DEFAULT '',
            severity_number UInt8 DEFAULT 0,
            data String DEFAULT '{}',
            project_id String,
            branch_id String,
            user_id Nullable(String),
            team_id Nullable(String),
            refresh_token_id Nullable(String),
            session_replay_id Nullable(String),
            session_replay_segment_id Nullable(String),
            parent_span_ids Array(String) DEFAULT [],
            trace_id Nullable(String),
            span_id Nullable(String),
            trace_flags UInt8 DEFAULT 0,
            source LowCardinality(String) DEFAULT 'hexclave',
            service_namespace LowCardinality(Nullable(String)),
            service_name LowCardinality(Nullable(String)),
            service_version Nullable(String),
            service_instance_id Nullable(String),
            deployment_environment_name LowCardinality(Nullable(String)),
            resource_attributes String DEFAULT '{}',
            resource_schema_url Nullable(String),
            scope_name LowCardinality(Nullable(String)),
            scope_version Nullable(String),
            scope_attributes String DEFAULT '{}',
            scope_schema_url Nullable(String),
            dropped_attributes UInt32 DEFAULT 0,
            created_at DateTime64(3, 'UTC') DEFAULT now64(3),
            INDEX idx_source source TYPE set(0) GRANULARITY 4
        )
        ENGINE MergeTree
        PARTITION BY toYYYYMM(event_at)
        ORDER BY (project_id, branch_id, event_at)
      `,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.${table} (event_type, event_at, project_id, branch_id, source) VALUES ('$click', now64(3), 'p', 'b', 'hexclave')`,
    });

    await client.command({ query: buildColumnUpgradeSql(`${testDatabase}.${table}`, EVENTS_COLUMNS) });
    await client.command({ query: buildEventsLegacyCleanupSql(`${testDatabase}.${table}`) });

    // Converges on exactly the canonical physical shape (order included) —
    // the guarantee that matters, checked against a real ClickHouse rather than
    // server, where DROP COLUMN ordering constraints actually bite.
    expect(await getColumnNames(table)).toEqual(EVENTS_COLUMNS.map((column) => column.name));
    const indexSet = await client.query({
      query: "SELECT name FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String}",
      query_params: { database: testDatabase, table },
      format: "JSONEachRow",
    });
    expect(await indexSet.json<{ name: string }>()).toEqual([]);
    // Existing rows survive the cleanup.
    expect(await countRows(table)).toBe(1);

    // Idempotent: a second run (fully IF EXISTS actions) is a no-op.
    await client.command({ query: buildEventsLegacyCleanupSql(`${testDatabase}.${table}`) });
    expect(await getColumnNames(table)).toEqual(EVENTS_COLUMNS.map((column) => column.name));
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

  test("ensureSkipIndex adds and materializes the index exactly once", async () => {
    const table = "skip_index_probe";
    await client.command({
      query: `CREATE TABLE ${testDatabase}.${table} (project_id String, event_type LowCardinality(String)) ENGINE MergeTree ORDER BY project_id`,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.${table} (project_id, event_type) VALUES ('p', '$log')`,
    });

    const options = { database: testDatabase, table, indexName: EVENTS_EVENT_TYPE_INDEX_NAME, indexDefinitionSql: EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL, materializeHistoricalParts: true };
    await ensureSkipIndex(client, options);

    const resultSet = await client.query({
      query: "SELECT count() AS count FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String} AND name = {indexName:String}",
      query_params: { database: testDatabase, table, indexName: EVENTS_EVENT_TYPE_INDEX_NAME },
      format: "JSONEachRow",
    });
    expect(Number((await resultSet.json<{ count: number | string }>())[0].count)).toBe(1);

    // The MATERIALIZE INDEX mutation must be scheduled exactly once — reruns
    // are guarded by the system.data_skipping_indices probe.
    const mutationsAfterFirstRun = await countMutations(table);
    expect(mutationsAfterFirstRun).toBeGreaterThanOrEqual(1);
    await ensureSkipIndex(client, options);
    expect(await countMutations(table)).toBe(mutationsAfterFirstRun);
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

  test("a pre-grouping logs table upgrades to exactly the freshly-created shape", async () => {
    const upgraded = "logs_grouping_upgrade_probe";
    const fresh = "logs_grouping_fresh_probe";
    // The vintage that predates the grouping columns: `logs` was a byte-for-byte
    // alias of the events shape.
    await client.command({
      query: `
        CREATE TABLE ${testDatabase}.${upgraded} (
            ${(EVENTS_COLUMNS as readonly ClickhouseColumn[]).map((column) => `${column.name} ${column.type}${column.default == null ? "" : ` DEFAULT ${column.default}`}`).join(",\n            ")}
        )
        ENGINE MergeTree
        PARTITION BY toYYYYMM(event_at)
        ORDER BY (project_id, branch_id, event_at)
      `,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.${upgraded} (event_type, event_at, data, project_id, branch_id) VALUES ('$error', now64(3), '{}', 'p', 'b')`,
    });

    await client.command({ query: buildColumnUpgradeSql(`${testDatabase}.${upgraded}`, LOGS_COLUMNS) });
    await client.command({ query: buildLogsCreateTableSql(`${testDatabase}.${fresh}`) });

    // Physical order, not just membership: the ALTER path and the CREATE path
    // must converge, or a positional INSERT would mis-pair same-typed columns.
    expect(await getColumnNames(upgraded)).toEqual(names(LOGS_COLUMNS));
    expect(await getColumnNames(upgraded)).toEqual(await getColumnNames(fresh));

    // The pre-existing row survives and reads back as the empty defaults rather
    // than NULL — this is what lets `issue_hash != ''` be the one and only
    // "grouped?" predicate.
    const resultSet = await client.query({
      query: `SELECT occurrence_id, batch_id, issue_hash, issue_hashes, issue_variant, grouping_degraded, error_frames FROM ${testDatabase}.${upgraded}`,
      format: "JSONEachRow",
    });
    expect(await resultSet.json()).toEqual([{
      occurrence_id: "",
      batch_id: "",
      issue_hash: "",
      issue_hashes: [],
      issue_variant: "",
      grouping_degraded: 0,
      error_frames: "",
    }]);
  });

  test("the rollup materialized view's output types match its target table exactly", async () => {
    await client.command({ query: buildLogsCreateTableSql(`${testDatabase}.logs`) });
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
    await client.command({ query: buildLogsCreateTableSql(`${testDatabase}.logs`) });
    await client.command({ query: buildIssueOccurrenceRollupCreateTableSql(testDatabase) });
    await client.command({ query: buildIssueOccurrenceRollupMvSql(testDatabase) });

    await client.command({
      query: `
        INSERT INTO ${testDatabase}.logs (event_type, event_at, data, project_id, branch_id, user_id, service_name, deployment_environment_name, issue_hash) VALUES
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
