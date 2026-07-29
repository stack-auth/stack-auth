import { getClickhouseAdminClient, type ClickHouseClient } from "@/lib/clickhouse";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  EVENTS_COLUMNS,
  EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL,
  EVENTS_EVENT_TYPE_INDEX_NAME,
  EVENTS_LEGACY_COLUMNS_TO_DROP,
  LOGS_COLUMNS,
  REFRESH_TOKEN_SPAN_SELECT_ALIASES,
  REFRESH_TOKEN_SPAN_SELECT_SQL,
  SPANS_COLUMNS,
  SPANS_RECREATE_COPY_COLUMNS,
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
  buildEventsLegacyCleanupSql,
  buildSpanLinksCreateTableSql,
  buildSpanWritesCreateTableSql,
  buildSpanWritesMvSql,
  buildSpansCreateTableSql,
  buildTelemetryInsertDeduplicationSettingSql,
  buildTraceRootsCreateTableSql,
  buildTraceServicesCreateTableSql,
  backfillDerivedSpanTable,
  dropDerivedTableIfLegacyShape,
  dropDerivedTableIfMissingColumn,
  ensureMaterializedViewUpToDate,
  ensureSkipIndex,
  ensureTableTtl,
  recreatePreReleaseTableIfLayoutChanged,
  selectColumnNames,
  type ClickhouseColumn,
} from "./clickhouse-migrations";

/**
 * Replays an `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` upgrade statement the way
 * ClickHouse would, so the tests below can assert what shape a database of a
 * given vintage ends up with. Only the positional part matters here, so this
 * reads each action's column name and its `FIRST` / `AFTER x` placement.
 */
function replayUpgrade(existingColumns: readonly string[], upgradeSql: string): string[] {
  const columns = [...existingColumns];
  const actions = upgradeSql.matchAll(/ADD COLUMN IF NOT EXISTS (\S+) .*?(FIRST|AFTER (\S+))(?=,\n|;)/g);
  let actionCount = 0;
  for (const action of actions) {
    actionCount += 1;
    const [, name, position, after] = action;
    if (columns.includes(name)) continue;
    if (position === "FIRST") {
      columns.unshift(name);
      continue;
    }
    const afterIndex = columns.indexOf(after);
    expect(afterIndex, `${name} is placed after ${after}, which does not exist yet`).toBeGreaterThanOrEqual(0);
    columns.splice(afterIndex + 1, 0, name);
  }
  expect(actionCount, "no ADD COLUMN actions were parsed out of the upgrade statement").toBeGreaterThan(0);
  return columns;
}

function names(columns: readonly ClickhouseColumn[]): string[] {
  return columns.map((column) => column.name);
}

/**
 * The `analytics_internal.events` columns as they existed before any of the
 * telemetry/session-replay columns were introduced. Any deployment older than
 * those columns looks exactly like this, so it is the vintage the upgrade path
 * has to bring forward.
 */
const PRE_TELEMETRY_EVENTS_COLUMNS = [
  "event_type",
  "event_at",
  "data",
  "project_id",
  "branch_id",
  "user_id",
  "team_id",
  "created_at",
];

/**
 * The events columns as an intermediate (never released) revision of the
 * telemetry branch created them on dev/staging: log fields as body/severity,
 * `source` instead of `producer`, plus the protocol-mirroring resource/scope
 * columns. The upgrade + legacy cleanup must bring this vintage to exactly the
 * canonical shape.
 */
const BRANCH_VINTAGE_EVENTS_COLUMNS = [
  "event_type",
  "event_at",
  "body",
  "severity_text",
  "severity_number",
  "data",
  "project_id",
  "branch_id",
  "user_id",
  "team_id",
  "refresh_token_id",
  "session_replay_id",
  "session_replay_segment_id",
  "parent_span_ids",
  "trace_id",
  "span_id",
  "trace_flags",
  "source",
  "service_namespace",
  "service_name",
  "service_version",
  "service_instance_id",
  "deployment_environment_name",
  "resource_attributes",
  "resource_schema_url",
  "scope_name",
  "scope_version",
  "scope_attributes",
  "scope_schema_url",
  "dropped_attributes",
  "created_at",
];

describe("column upgrade paths", () => {
  test("a pre-telemetry events table upgrades to exactly the freshly-created shape", () => {
    // `default.events` is created from EVENTS_COLUMNS, so a divergence here
    // would mean two deployments answering the same customer query with
    // differently-ordered columns.
    expect(replayUpgrade(PRE_TELEMETRY_EVENTS_COLUMNS, buildColumnUpgradeSql("t", EVENTS_COLUMNS)))
      .toEqual(names(EVENTS_COLUMNS));
  });

  test("a branch-vintage events table converges on the canonical shape after upgrade + legacy cleanup", () => {
    const upgraded = replayUpgrade(BRANCH_VINTAGE_EVENTS_COLUMNS, buildColumnUpgradeSql("t", EVENTS_COLUMNS));
    const legacyColumns = new Set<string>(EVENTS_LEGACY_COLUMNS_TO_DROP);
    const afterCleanup = upgraded.filter((column) => !legacyColumns.has(column));
    // Not just the same set — the exact same PHYSICAL order as a fresh table,
    // because message/level/producer/runtime are positioned relative to
    // columns both vintages share.
    expect(afterCleanup).toEqual(names(EVENTS_COLUMNS));
  });

  test("the legacy cut-list is disjoint from the declared events columns", () => {
    // A column appearing in both would be added by the upgrade and immediately
    // dropped by the cleanup on every boot.
    const declared = new Set<string>(names(EVENTS_COLUMNS));
    for (const legacyColumn of EVENTS_LEGACY_COLUMNS_TO_DROP) {
      expect(declared.has(legacyColumn), `${legacyColumn} is both declared and in the legacy cut-list`).toBe(false);
    }
  });

  test.each([
    ["events", EVENTS_COLUMNS],
    ["logs", LOGS_COLUMNS],
    ["span_events", SPAN_EVENTS_COLUMNS],
    ["spans", SPANS_COLUMNS],
    ["span_links", SPAN_LINKS_COLUMNS],
    ["trace_roots", TRACE_ROOTS_COLUMNS],
    ["trace_services", TRACE_SERVICES_COLUMNS],
  ])("%s: upgrading an absent table reproduces the declared order", (_table, columns) => {
    expect(replayUpgrade([], buildColumnUpgradeSql("t", columns))).toEqual(names(columns));
  });

  test.each([
    ["events", EVENTS_COLUMNS],
    ["spans", SPANS_COLUMNS],
    ["span_links", SPAN_LINKS_COLUMNS],
    ["trace_roots", TRACE_ROOTS_COLUMNS],
    ["trace_services", TRACE_SERVICES_COLUMNS],
  ])("%s: upgrading an already-current table changes nothing", (_table, columns) => {
    expect(replayUpgrade(names(columns), buildColumnUpgradeSql("t", columns))).toEqual(names(columns));
  });

  test("a pre-TTL trace_services table upgrades to exactly the freshly-created shape", () => {
    // trace_services existed before its `created_at` column (added for the
    // retention TTL); that vintage must converge on the canonical order, since
    // the backfill INSERT INTO ... SELECT pairs columns positionally.
    const preTtlColumns = names(TRACE_SERVICES_COLUMNS).filter((name) => name !== "created_at");
    expect(replayUpgrade(preTtlColumns, buildColumnUpgradeSql("t", TRACE_SERVICES_COLUMNS)))
      .toEqual(names(TRACE_SERVICES_COLUMNS));
  });

  test("a table that gained a column out of position still receives the missing ones", () => {
    // Databases from an intermediate revision of the spans work have some
    // columns in a different physical spot. They must still end up with every
    // column, otherwise the `default.*` views fail to create and take the boot
    // down with them.
    const outOfOrder = [
      ...names(SPANS_COLUMNS).filter((name) => !["kind", "status_code", "data"].includes(name)),
    ];
    const upgraded = replayUpgrade(outOfOrder, buildColumnUpgradeSql("t", SPANS_COLUMNS));
    expect([...upgraded].sort()).toEqual([...names(SPANS_COLUMNS)].sort());
  });
});

describe("legacy spans recreate mapping", () => {
  test("targets exactly the declared spans columns, mapping only the renamed/new trio", () => {
    expect(SPANS_RECREATE_COPY_COLUMNS.map((column) => column.target)).toEqual(names(SPANS_COLUMNS));
    const remapped = SPANS_RECREATE_COPY_COLUMNS.filter((column) => column.sourceExpression !== column.target);
    expect(remapped).toEqual([
      { target: "span_type", sourceExpression: "name" },
      { target: "data", sourceExpression: "attributes" },
      { target: "producer", sourceExpression: "'sdk'" },
    ]);
  });
});

describe("default.spans UNION ALL branches", () => {
  test("the refresh-token projection aliases the spans columns in order", () => {
    // ClickHouse pairs UNION ALL branches by POSITION, and neighbouring columns
    // here share types (service_version / service_instance_id, and the String
    // attribute blobs), so a reordering would silently mis-pair columns
    // instead of raising.
    expect(REFRESH_TOKEN_SPAN_SELECT_ALIASES).toEqual(selectColumnNames(SPANS_COLUMNS, ["version"]));
  });

  test("the pinned alias list matches the projection's actual output columns", () => {
    const selectBody = REFRESH_TOKEN_SPAN_SELECT_SQL
      .slice(REFRESH_TOKEN_SPAN_SELECT_SQL.indexOf("SELECT") + "SELECT".length, REFRESH_TOKEN_SPAN_SELECT_SQL.indexOf("FROM analytics_internal.refresh_tokens"));
    const outputColumns = selectBody
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.length > 0)
      // Everything is either `<expression> AS <name>` or a bare column name.
      .map((line) => line.split(/ AS /).at(-1) ?? line);
    expect(outputColumns).toEqual([...REFRESH_TOKEN_SPAN_SELECT_ALIASES]);
  });
});

describe("derived read models", () => {
  test("the trace inbox does not promote unparented HTTP client bridge spans to roots", () => {
    expect(TRACE_ROOTS_SOURCE_SELECT_SQL).toContain("WHERE empty(parent_span_ids)");
    expect(TRACE_ROOTS_SOURCE_SELECT_SQL).toContain("span_type != '$http-client'");
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

  test("the trace inbox adds the canonical refresh-token boundary for SDK traces", () => {
    expect(TRACE_ROOTS_VIEW_SQL).toContain("FROM analytics_internal.trace_roots FINAL");
    expect(TRACE_ROOTS_VIEW_SQL).toContain("UNION ALL");
    expect(TRACE_ROOTS_VIEW_SQL).toContain("analytics_internal.refresh_tokens");
    expect(TRACE_ROOTS_VIEW_SQL).not.toContain("length(parent_span_ids) = 1");
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
    expect(sql).toContain("ORDER BY (project_id, branch_id, trace_id, owner_span_id, linked_trace_id, linked_span_id)");
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

  test("the billing view zero-rates backend self-exported spans and system spans", () => {
    // The exact WHERE clause is billing-critical: dropping the producer
    // condition would meter Hexclave's own self-instrumentation writes against
    // the customer, dropping the $-prefix condition would meter free system
    // autocapture spans. Also covered end-to-end by the integration test below.
    expect(buildSpanWritesMvSql("analytics_internal")).toContain("WHERE producer = 'sdk' AND NOT startsWith(span_type, '$')");
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

  // The spans recreate probe/copy exactly as runClickhouseMigrations wires it,
  // minus the database name. Kept in one place so both recreate tests below
  // cannot drift from production behavior.
  const spansRecreateOptions = {
    database: testDatabase,
    table: "spans",
    needsRecreate: (info: { engine: string, partition_key: string, columnNames: readonly string[] }) =>
      info.partition_key !== "toYYYYMM(started_at)" || info.columnNames.includes("name"),
    buildCreateSql: buildSpansCreateTableSql,
    copyColumns: SPANS_RECREATE_COPY_COLUMNS,
  };

  test("recreates a legacy-shaped spans table: partition fix, rename mapping, cut columns, dedup", async () => {
    // The legacy dev/staging vintage: partitioned by ingestion time, `name` /
    // `attributes` instead of `span_type` / `data`, no `producer`, and the
    // since-cut protocol columns. (A literal snapshot of the old CREATE —
    // deliberately not derived from current declarations, because it describes
    // the past, not the present.)
    await client.command({
      query: `
        CREATE TABLE ${testDatabase}.spans (
            trace_id String,
            span_id String,
            name LowCardinality(String),
            started_at DateTime64(3, 'UTC'),
            ended_at Nullable(DateTime64(3, 'UTC')),
            parent_span_ids Array(String) DEFAULT [],
            kind LowCardinality(String) DEFAULT 'internal',
            status_code LowCardinality(String) DEFAULT 'unset',
            status_message Nullable(String),
            trace_state Nullable(String),
            trace_flags UInt32 DEFAULT 0,
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
            attributes String DEFAULT '{}',
            dropped_attributes UInt32 DEFAULT 0,
            project_id String,
            branch_id String,
            user_id Nullable(String),
            team_id Nullable(String),
            refresh_token_id Nullable(String),
            session_replay_id Nullable(String),
            session_replay_segment_id Nullable(String),
            created_at DateTime64(3, 'UTC') DEFAULT now64(3),
            version UInt64
        )
        ENGINE ReplacingMergeTree(version)
        PARTITION BY toYYYYMM(created_at)
        ORDER BY (project_id, branch_id, trace_id, span_id)
      `,
    });

    // The same span identity re-upserted in a later calendar month: under the
    // legacy layout the two rows sit in different partitions, where background
    // merges can never collapse them. Dates are relative to now — inside the
    // retention TTL (which would drop expired rows on insert) but one calendar
    // month apart.
    const startedAt = toClickhouseDateTime(new Date());
    const createdAtFirstExport = toClickhouseDateTime(new Date());
    const createdAtRetriedExport = toClickhouseDateTime(new Date(Date.now() + 35 * 24 * 60 * 60 * 1000));
    await client.command({
      query: `
        INSERT INTO ${testDatabase}.spans (trace_id, span_id, name, started_at, attributes, trace_state, project_id, branch_id, version, created_at) VALUES
        ('trace-1', 'span-1', 'checkout', '${startedAt}', '{"step":1}', 'vendor=legacy', 'p', 'b', 1, '${createdAtFirstExport}'),
        ('trace-1', 'span-1', 'checkout', '${startedAt}', '{"step":2}', 'vendor=legacy', 'p', 'b', 2, '${createdAtRetriedExport}')
      `,
    });
    expect(await countRows("spans")).toBe(2);
    expect(await countActivePartitions("spans")).toBe(2);

    // Mirror production ordering: the column upgrade runs BEFORE the recreate,
    // so the legacy table also carries (empty) span_type/data/producer columns
    // when the copy runs — the copy must still read the LEGACY columns.
    await client.command({ query: buildColumnUpgradeSql(`${testDatabase}.spans`, SPANS_COLUMNS) });

    // A materialized view reading from the table, like span_writes_mv /
    // trace_roots_mv in production — it must keep firing after the swap.
    await client.command({
      query: `CREATE TABLE ${testDatabase}.spans_probe (project_id String, version UInt64) ENGINE MergeTree ORDER BY project_id`,
    });
    await client.command({
      query: `CREATE MATERIALIZED VIEW ${testDatabase}.spans_probe_mv TO ${testDatabase}.spans_probe AS SELECT project_id, version FROM ${testDatabase}.spans`,
    });

    expect(await recreatePreReleaseTableIfLayoutChanged(client, spansRecreateOptions)).toBe(true);

    expect((await getTableLayout("spans")).partition_key).toBe("toYYYYMM(started_at)");
    // The recreated table has exactly the canonical columns — renamed ones
    // mapped, cut ones gone.
    expect(await getColumnNames("spans")).toEqual(SPANS_COLUMNS.map((column) => column.name));
    // The rows now share the started_at partition, so they physically collapse
    // to the latest version. (No assertion on the pre-FINAL row count:
    // optimize_on_insert may already collapse them during the copy's INSERT.)
    expect(await countActivePartitions("spans")).toBe(1);
    expect(await countRows("spans", { final: true })).toBe(1);
    const survivorSet = await client.query({
      query: `SELECT span_type, data, producer, version FROM ${testDatabase}.spans FINAL`,
      format: "JSONEachRow",
    });
    const survivors = await survivorSet.json<{ span_type: string, data: string, producer: string, version: number | string }>();
    expect(survivors).toHaveLength(1);
    // The rename mapping carried the legacy values into the new columns...
    expect(survivors[0].span_type).toBe("checkout");
    expect(survivors[0].data).toBe('{"step":2}');
    // ...and pre-release rows are stamped as SDK telemetry.
    expect(survivors[0].producer).toBe("sdk");
    expect(Number(survivors[0].version)).toBe(2);
    // The copy must not fire materialized views (it would double-bill
    // span_writes in production)...
    expect(await countRows("spans_probe")).toBe(0);
    // ...but inserts after the swap must still reach them.
    await client.command({
      query: `
        INSERT INTO ${testDatabase}.spans (trace_id, span_id, span_type, started_at, project_id, branch_id, version) VALUES
        ('trace-2', 'span-2', 'checkout', '${startedAt}', 'p', 'b', 3)
      `,
    });
    expect(await countRows("spans_probe")).toBe(1);

    // Idempotent: the canonical layout is in place, so a rerun is a no-op.
    expect(await recreatePreReleaseTableIfLayoutChanged(client, spansRecreateOptions)).toBe(false);
  });

  test("the span_writes billing view meters only non-$ SDK spans", async () => {
    // Uses the spans table recreated by the previous test (canonical shape).
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

  test("a leftover temporary table from a crashed run is discarded, not swapped in", async () => {
    const table = "leftover_probe";
    await client.command({
      query: `CREATE TABLE ${testDatabase}.${table} (id String) ENGINE MergeTree ORDER BY id`,
    });
    await client.command({
      query: `CREATE TABLE ${testDatabase}.${table}__layout_migration (id String) ENGINE MergeTree ORDER BY id`,
    });

    expect(await recreatePreReleaseTableIfLayoutChanged(client, {
      database: testDatabase,
      table,
      needsRecreate: () => false,
      buildCreateSql: (fullTableName) => `CREATE TABLE IF NOT EXISTS ${fullTableName} (id String) ENGINE MergeTree ORDER BY id`,
      copyColumns: [{ target: "id", sourceExpression: "id" }],
    })).toBe(false);

    const resultSet = await client.query({
      query: "SELECT count() AS count FROM system.tables WHERE database = {database:String} AND name = {table:String}",
      query_params: { database: testDatabase, table: `${table}__layout_migration` },
      format: "JSONEachRow",
    });
    expect(Number((await resultSet.json<{ count: number | string }>())[0].count)).toBe(0);
  });

  test("recreates a MergeTree span_links table as a deduplicating ReplacingMergeTree", async () => {
    const legacySql = buildSpanLinksCreateTableSql(`${testDatabase}.span_links`)
      .replace("ENGINE ReplacingMergeTree(created_at)", "ENGINE MergeTree");
    expect(legacySql).toContain("ENGINE MergeTree");
    await client.command({ query: legacySql });

    // An at-least-once export retry: the identical link inserted twice.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await client.command({
        query: `
          INSERT INTO ${testDatabase}.span_links (project_id, branch_id, trace_id, owner_span_id, linked_trace_id, linked_span_id) VALUES
          ('p', 'b', 'trace-1', 'span-1', 'trace-9', 'span-9')
        `,
      });
    }
    expect(await countRows("span_links")).toBe(2);

    const recreateOptions = {
      database: testDatabase,
      table: "span_links",
      needsRecreate: (info: { engine: string, partition_key: string }) => info.engine !== "ReplacingMergeTree",
      buildCreateSql: buildSpanLinksCreateTableSql,
      copyColumns: SPAN_LINKS_COLUMNS.map((column) => ({ target: column.name, sourceExpression: column.name })),
    };
    expect(await recreatePreReleaseTableIfLayoutChanged(client, recreateOptions)).toBe(true);

    expect((await getTableLayout("span_links")).engine).toBe("ReplacingMergeTree");
    expect(await countRows("span_links", { final: true })).toBe(1);
    expect(await recreatePreReleaseTableIfLayoutChanged(client, recreateOptions)).toBe(false);
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
    // same guarantee the replayUpgrade unit test makes, but against the real
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

  test("dropDerivedTableIfLegacyShape drops only tables that still carry the legacy column", async () => {
    await client.command({
      query: `CREATE TABLE ${testDatabase}.legacy_roots (name String, span_id String) ENGINE MergeTree ORDER BY span_id`,
    });
    await client.command({
      query: `CREATE TABLE ${testDatabase}.current_roots (span_type String, span_id String) ENGINE MergeTree ORDER BY span_id`,
    });

    await dropDerivedTableIfLegacyShape(client, { database: testDatabase, table: "legacy_roots", legacyColumnName: "name" });
    await dropDerivedTableIfLegacyShape(client, { database: testDatabase, table: "current_roots", legacyColumnName: "name" });
    // Absent tables are a no-op, not an error (fresh databases).
    await dropDerivedTableIfLegacyShape(client, { database: testDatabase, table: "never_existed", legacyColumnName: "name" });

    const resultSet = await client.query({
      query: "SELECT name FROM system.tables WHERE database = {database:String} AND name IN ('legacy_roots', 'current_roots')",
      query_params: { database: testDatabase },
      format: "JSONEachRow",
    });
    expect((await resultSet.json<{ name: string }>()).map((row) => row.name)).toEqual(["current_roots"]);
  });

  test("dropDerivedTableIfMissingColumn rebuilds only an existing incomplete read model", async () => {
    await client.command({
      query: `CREATE TABLE ${testDatabase}.incomplete_roots (span_type String) ENGINE MergeTree ORDER BY span_type`,
    });
    await client.command({
      query: `CREATE TABLE ${testDatabase}.complete_roots (span_type String, scope_name Nullable(String)) ENGINE MergeTree ORDER BY span_type`,
    });

    await dropDerivedTableIfMissingColumn(client, {
      database: testDatabase,
      table: "incomplete_roots",
      requiredColumnName: "scope_name",
    });
    await dropDerivedTableIfMissingColumn(client, {
      database: testDatabase,
      table: "complete_roots",
      requiredColumnName: "scope_name",
    });
    await dropDerivedTableIfMissingColumn(client, {
      database: testDatabase,
      table: "never_existed",
      requiredColumnName: "scope_name",
    });

    const resultSet = await client.query({
      query: "SELECT name FROM system.tables WHERE database = {database:String} AND name IN ('incomplete_roots', 'complete_roots')",
      query_params: { database: testDatabase },
      format: "JSONEachRow",
    });
    expect((await resultSet.json<{ name: string }>()).map((row) => row.name)).toEqual(["complete_roots"]);
  });

  test("a forced derived-table backfill is not skipped when the materialized view wins the startup race", async () => {
    await client.command({
      query: `CREATE TABLE ${testDatabase}.backfill_source (id String, version UInt64) ENGINE MergeTree ORDER BY id`,
    });
    await client.command({
      query: `CREATE TABLE ${testDatabase}.backfill_target (id String, version UInt64) ENGINE ReplacingMergeTree(version) ORDER BY id`,
    });
    await client.command({
      query: `INSERT INTO ${testDatabase}.backfill_source VALUES ('racing-root', 1), ('historical-root', 1)`,
    });
    // Simulates a row arriving through the newly attached MV before the
    // historical copy starts.
    await client.command({
      query: `INSERT INTO ${testDatabase}.backfill_target VALUES ('racing-root', 1)`,
    });

    await backfillDerivedSpanTable(client, {
      database: testDatabase,
      table: "backfill_target",
      selectSql: `SELECT id, version FROM ${testDatabase}.backfill_source`,
      force: true,
    });

    const resultSet = await client.query({
      query: `SELECT id FROM ${testDatabase}.backfill_target FINAL ORDER BY id`,
      format: "JSONEachRow",
    });
    expect((await resultSet.json<{ id: string }>()).map((row) => row.id)).toEqual([
      "historical-root",
      "racing-root",
    ]);
  });

  test("ensureMaterializedViewUpToDate replaces a stale definition exactly once", async () => {
    await client.command({
      query: `CREATE TABLE ${testDatabase}.mv_source (span_type String) ENGINE MergeTree ORDER BY span_type`,
    });
    await client.command({
      query: `CREATE TABLE ${testDatabase}.mv_target (span_type String) ENGINE MergeTree ORDER BY span_type`,
    });
    // A stale vintage: selects a legacy alias the current definition no longer
    // contains (mirrors trace_roots_mv still selecting `name`).
    await client.command({
      query: `CREATE MATERIALIZED VIEW ${testDatabase}.probe_mv TO ${testDatabase}.mv_target AS SELECT concat(span_type, '-legacy') AS span_type FROM ${testDatabase}.mv_source`,
    });

    const currentSql = `CREATE MATERIALIZED VIEW IF NOT EXISTS ${testDatabase}.probe_mv TO ${testDatabase}.mv_target AS SELECT span_type FROM ${testDatabase}.mv_source`;
    const options = {
      database: testDatabase,
      name: "probe_mv",
      isUpToDate: (createQuery: string) => !createQuery.includes("-legacy"),
      createSql: currentSql,
    };

    await ensureMaterializedViewUpToDate(client, options);
    await client.command({ query: `INSERT INTO ${testDatabase}.mv_source (span_type) VALUES ('checkout')` });
    const targetSet = await client.query({
      query: `SELECT span_type FROM ${testDatabase}.mv_target`,
      format: "JSONEachRow",
    });
    // The replaced view writes the un-suffixed value — the stale one is gone.
    expect(await targetSet.json<{ span_type: string }>()).toEqual([{ span_type: "checkout" }]);

    // Second run: definition is current, so it must not be dropped/recreated.
    const beforeSet = await client.query({
      query: "SELECT metadata_modification_time FROM system.tables WHERE database = {database:String} AND name = 'probe_mv'",
      query_params: { database: testDatabase },
      format: "JSONEachRow",
    });
    const before = await beforeSet.json<{ metadata_modification_time: string }>();
    await ensureMaterializedViewUpToDate(client, options);
    const afterSet = await client.query({
      query: "SELECT metadata_modification_time FROM system.tables WHERE database = {database:String} AND name = 'probe_mv'",
      query_params: { database: testDatabase },
      format: "JSONEachRow",
    });
    expect(await afterSet.json<{ metadata_modification_time: string }>()).toEqual(before);
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

    const options = { database: testDatabase, table, indexName: EVENTS_EVENT_TYPE_INDEX_NAME, indexDefinitionSql: EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL };
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
});
