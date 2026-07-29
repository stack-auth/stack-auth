import { getClickhouseAdminClient, type ClickHouseClient } from "@/lib/clickhouse";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { throwErr } from "@hexclave/shared/dist/utils/errors";

export async function runClickhouseMigrations() {
  const start = performance.now();
  console.log("[Clickhouse] Running Clickhouse migrations...");
  const client = getClickhouseAdminClient();
  const clickhouseExternalPassword = getEnvVariable("STACK_CLICKHOUSE_EXTERNAL_PASSWORD");

  // Setup — database, user, sync metadata
  await client.command({ query: EXTERNAL_ANALYTICS_DB_SQL });
  await Promise.all([
    client.command({
      query: "CREATE USER IF NOT EXISTS limited_user IDENTIFIED WITH sha256_password BY {clickhouseExternalPassword:String}",
      query_params: { clickhouseExternalPassword },
    }),
    client.command({ query: SYNC_METADATA_TABLE_SQL }),
  ]);

  // Must run before the CREATE TABLEs below claim these names.
  await Promise.all([
    dropImplicitStorageMaterializedView(client, "trace_roots"),
    dropImplicitStorageMaterializedView(client, "trace_services"),
  ]);

  const traceRootsExistedBeforeShapeChecks = await clickhouseTableExists(client, {
    database: "analytics_internal",
    table: "trace_roots",
  });

  // trace_roots is a derived read model, so a pre-release deployment that still
  // has the legacy column set (`name` instead of `span_type`) is simply dropped
  // and rebuilt: the CREATE below recreates it with the current shape and
  // backfillDerivedSpanTable repopulates it from the spans table. Cheaper and
  // simpler than a copy-and-swap for a table whose content is 100% derivable.
  const traceRootsLegacyShapeDropped = await dropDerivedTableIfLegacyShape(client, { database: "analytics_internal", table: "trace_roots", legacyColumnName: "name" });
  const traceRootsMissingScopeDropped = await dropDerivedTableIfMissingColumn(client, { database: "analytics_internal", table: "trace_roots", requiredColumnName: "scope_name" });
  const traceRootsMissingDataDropped = await dropDerivedTableIfMissingColumn(client, { database: "analytics_internal", table: "trace_roots", requiredColumnName: "data" });
  const forceTraceRootsBackfill = !traceRootsExistedBeforeShapeChecks
    || traceRootsLegacyShapeDropped
    || traceRootsMissingScopeDropped
    || traceRootsMissingDataDropped;

  // Create all tables in parallel
  await Promise.all([
    client.command({ query: EVENTS_TABLE_BASE_SQL }),
    client.command({ query: LOGS_TABLE_BASE_SQL }),
    client.command({ query: SPAN_EVENTS_TABLE_BASE_SQL }),
    client.command({ query: USERS_TABLE_BASE_SQL }),
    client.command({ query: CONTACT_CHANNELS_TABLE_BASE_SQL }),
    client.command({ query: TEAMS_TABLE_BASE_SQL }),
    client.command({ query: TEAM_MEMBER_PROFILES_TABLE_BASE_SQL }),
    client.command({ query: TEAM_PERMISSIONS_TABLE_BASE_SQL }),
    client.command({ query: TEAM_INVITATIONS_TABLE_BASE_SQL }),
    client.command({ query: EMAIL_OUTBOXES_TABLE_BASE_SQL }),

    client.command({ query: PROJECT_PERMISSIONS_TABLE_BASE_SQL }),
    client.command({ query: NOTIFICATION_PREFERENCES_TABLE_BASE_SQL }),
    client.command({ query: REFRESH_TOKENS_TABLE_BASE_SQL }),
    client.command({ query: CONNECTED_ACCOUNTS_TABLE_BASE_SQL }),
    client.command({ query: CLICKMAP_EVENTS_TABLE_SQL }),
    client.command({ query: SPANS_TABLE_BASE_SQL }),
    client.command({ query: SPAN_LINKS_TABLE_SQL }),
    client.command({ query: SPAN_WRITES_TABLE_SQL }),
    client.command({ query: TRACE_ROOTS_TABLE_SQL }),
    client.command({ query: TRACE_SERVICES_TABLE_SQL }),
  ]);

  await client.command({ query: CLICKMAP_EVENTS_ADD_DEAD_COLUMN_SQL });

  // Existing databases may predate columns that the base schemas above now
  // declare, and `CREATE TABLE IF NOT EXISTS` will not add them. These ALTERs
  // must run before the dependent materialized views and `default.*` views,
  // which name every column explicitly and would otherwise fail to create and
  // take the whole boot down with them.
  await Promise.all([
    client.command({ query: EVENTS_SCHEMA_UPGRADE_SQL }),
    client.command({ query: LOGS_SCHEMA_UPGRADE_SQL }),
    client.command({ query: SPAN_EVENTS_SCHEMA_UPGRADE_SQL }),
    client.command({ query: SPANS_SCHEMA_UPGRADE_SQL }),
    client.command({ query: SPAN_LINKS_SCHEMA_UPGRADE_SQL }),
    client.command({ query: TRACE_ROOTS_SCHEMA_UPGRADE_SQL }),
    client.command({ query: TRACE_SERVICES_SCHEMA_UPGRADE_SQL }),
  ]);

  // After the upgrades so it can never race an ADD COLUMN on the same table.
  // Purely IF EXISTS actions, so this is a no-op everywhere except pre-release
  // deployments that carry the retired log/tracing columns.
  await client.command({ query: EVENTS_LEGACY_CLEANUP_SQL });

  // The spans system is unreleased, but dev/staging deployments already created
  // its tables with an earlier physical layout that ADD COLUMN cannot fix
  // (partition key / table engine). These run after the column upgrades above so
  // the old table is guaranteed to have every column the copy selects, and
  // before the materialized views are (re)attached on a fresh boot.
  await Promise.all([
    recreatePreReleaseTableIfLayoutChanged(client, {
      database: "analytics_internal",
      table: "spans",
      // Two pre-release vintages need a rebuild: (1) partitioning by ingestion
      // time (see SPANS_TABLE_ENGINE_SQL: background merges only dedupe within
      // a partition, so a span re-upserted in a later month physically
      // duplicated forever), and (2) the legacy column set, detected via the
      // old `name` column (now `span_type` — see SPANS_RECREATE_COPY_COLUMNS
      // for the full mapping and the cut protocol columns).
      needsRecreate: (info) => info.partition_key !== "toYYYYMM(started_at)" || info.columnNames.includes("name"),
      buildCreateSql: buildSpansCreateTableSql,
      copyColumns: SPANS_RECREATE_COPY_COLUMNS,
    }),
    recreatePreReleaseTableIfLayoutChanged(client, {
      database: "analytics_internal",
      table: "span_links",
      // See SPAN_LINKS_TABLE_ENGINE_SQL: plain MergeTree kept every duplicate
      // produced by at-least-once export retries.
      needsRecreate: (info) => info.engine !== "ReplacingMergeTree",
      buildCreateSql: buildSpanLinksCreateTableSql,
      copyColumns: SPAN_LINKS_COLUMNS.map((column) => ({ target: column.name, sourceExpression: column.name })),
    }),
  ]);

  // The public batch id is also the ClickHouse insert idempotency key. A
  // single wire batch may target events, logs, and spans independently, so
  // every physical destination must remember enough recent insert tokens for
  // a retry to finish only the destination that previously failed.
  await Promise.all(TELEMETRY_INSERT_TABLES.map((table) => client.command({
    query: buildTelemetryInsertDeduplicationSettingSql(table),
  })));

  // Retention and skip indexes for tables that existed before the CREATE
  // statements declared them (CREATE ... IF NOT EXISTS never alters).
  await Promise.all([
    ensureTableTtl(client, { database: "analytics_internal", table: "events", ttlDays: TELEMETRY_TTL_DAYS }),
    ensureTableTtl(client, { database: "analytics_internal", table: "logs", ttlDays: TELEMETRY_TTL_DAYS }),
    ensureTableTtl(client, { database: "analytics_internal", table: "span_events", ttlDays: TELEMETRY_TTL_DAYS }),
    ensureTableTtl(client, { database: "analytics_internal", table: "spans", ttlDays: TELEMETRY_TTL_DAYS }),
    ensureTableTtl(client, { database: "analytics_internal", table: "span_links", ttlDays: TELEMETRY_TTL_DAYS }),
    // The derived read models expire on the same clock as their source spans.
    // For a pre-existing trace_services table, `created_at` was added by the
    // schema upgrade above with a non-materialized now64(3) default, so the
    // MODIFY TTL's one-shot mutation stamps its old rows with the mutation
    // time — i.e. they get a fresh 90-day lease rather than expiring early.
    ensureTableTtl(client, { database: "analytics_internal", table: "trace_roots", ttlDays: TELEMETRY_TTL_DAYS }),
    ensureTableTtl(client, { database: "analytics_internal", table: "trace_services", ttlDays: TELEMETRY_TTL_DAYS }),
    ensureTableTtl(client, { database: "analytics_internal", table: "span_writes", ttlDays: SPAN_WRITES_TTL_DAYS }),
    ensureSkipIndex(client, {
      database: "analytics_internal",
      table: "events",
      indexName: EVENTS_EVENT_TYPE_INDEX_NAME,
      indexDefinitionSql: EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL,
    }),
  ]);

  // Clickmap materialized view depends on the events table existing; create after the ALTER above
  // so the view sees the replay columns. IF NOT EXISTS makes this idempotent across reboots.
  await client.command({ query: CLICKMAP_EVENTS_MV_SQL });
  // trace_roots_mv and span_writes_mv changed with the spans column slimming
  // (`name` → `span_type`; the billing filter gained `producer`), and
  // `CREATE MATERIALIZED VIEW IF NOT EXISTS` never updates a stale definition —
  // a leftover would break every spans insert once the old columns are gone,
  // so they are dropped-and-recreated when their stored SELECT predates the
  // rename. trace_services_mv only touches unrenamed columns and stays plain.
  await ensureMaterializedViewUpToDate(client, {
    database: "analytics_internal",
    name: "trace_roots_mv",
    isUpToDate: (createQuery) => createQuery.includes("span_type")
      && createQuery.includes("$http-client")
      && createQuery.includes("scope_name")
      && createQuery.includes("data")
      && createQuery.includes("kind = 'internal'"),
    createSql: TRACE_ROOTS_MV_SQL,
  });
  await client.command({ query: TRACE_SERVICES_MV_SQL });
  await ensureMaterializedViewUpToDate(client, {
    database: "analytics_internal",
    name: "span_writes_mv",
    isUpToDate: (createQuery) => createQuery.includes("producer"),
    createSql: SPAN_WRITES_MV_SQL,
  });

  // Only after the materialized views above are attached, so no span written
  // during the backfill can slip through unrecorded.
  await Promise.all([
    backfillDerivedSpanTable(client, {
      table: "trace_roots",
      selectSql: TRACE_ROOTS_SOURCE_SELECT_SQL,
      force: forceTraceRootsBackfill,
    }),
    backfillDerivedSpanTable(client, { table: "trace_services", selectSql: TRACE_SERVICES_SOURCE_SELECT_SQL }),
  ]);

  // Create all views in parallel
  await Promise.all([
    client.command({ query: EVENTS_VIEW_SQL }),
    client.command({ query: LOGS_VIEW_SQL }),
    client.command({ query: ERRORS_VIEW_SQL }),
    client.command({ query: SPAN_EVENTS_VIEW_SQL }),
    client.command({ query: USERS_VIEW_SQL }),
    client.command({ query: CONTACT_CHANNELS_VIEW_SQL }),
    client.command({ query: TEAMS_VIEW_SQL }),
    client.command({ query: TEAM_MEMBER_PROFILES_VIEW_SQL }),
    client.command({ query: TEAM_PERMISSIONS_VIEW_SQL }),
    client.command({ query: TEAM_INVITATIONS_VIEW_SQL }),
    client.command({ query: EMAIL_OUTBOXES_VIEW_SQL }),

    client.command({ query: PROJECT_PERMISSIONS_VIEW_SQL }),
    client.command({ query: NOTIFICATION_PREFERENCES_VIEW_SQL }),
    client.command({ query: REFRESH_TOKENS_VIEW_SQL }),
    client.command({ query: CONNECTED_ACCOUNTS_VIEW_SQL }),
    client.command({ query: SPANS_VIEW_SQL }),
    client.command({ query: SPAN_LINKS_VIEW_SQL }),
    client.command({ query: TRACE_ROOTS_VIEW_SQL }),
    client.command({ query: TRACE_SERVICES_VIEW_SQL }),
  ]);

  // Data migrations (mutations)
  await Promise.all([
    client.command({ query: TOKEN_REFRESH_EVENT_ROW_FORMAT_MUTATION_SQL }),
    client.command({ query: BACKFILL_REFRESH_TOKEN_ID_COLUMN_SQL }),
    client.command({ query: SIGN_UP_RULE_TRIGGER_EVENT_ROW_FORMAT_MUTATION_SQL }),
  ]);

  // Add column comments to all views so DESCRIBE TABLE returns useful descriptions.
  // Comments are lost on CREATE OR REPLACE VIEW, so we re-apply them every migration run.
  // The AI query builder treats these comments as authoritative schema metadata,
  // so a partial application is incompatible with the backend version being deployed.
  // One ALTER per view keeps each view's metadata update atomic and avoids
  // contending on the same metadata lock with one command per column.
  for (const sql of COLUMN_COMMENT_SQL) {
    await client.command({ query: sql });
  }

  // Row policies in parallel
  const tables = [
    "events", "logs", "errors", "span_events", "users", "contact_channels", "teams", "team_member_profiles",
    "team_permissions", "team_invitations", "email_outboxes",
    "project_permissions", "notification_preferences", "refresh_tokens", "connected_accounts",
    "spans", "span_links", "trace_roots", "trace_services",
  ];
  await Promise.all(tables.map(table =>
    client.command({
      query: `CREATE ROW POLICY IF NOT EXISTS ${table}_project_isolation ON default.${table} FOR SELECT USING project_id = getSetting('SQL_project_id') AND branch_id = getSetting('SQL_branch_id') TO limited_user`,
    })
  ));

  // Grants
  await client.command({ query: "REVOKE ALL PRIVILEGES ON *.* FROM limited_user;" });
  await client.command({ query: "REVOKE ALL FROM limited_user;" });
  await Promise.all(tables.map(table =>
    client.command({ query: `GRANT SELECT ON default.${table} TO limited_user;` })
  ));

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`[Clickhouse] Clickhouse migrations complete (${elapsed}s)`);
  await client.close();
}

/**
 * `trace_roots` and `trace_services` were briefly created as materialized views
 * with implicit storage (`CREATE MATERIALIZED VIEW ... ENGINE ...` with no `TO`).
 * They are now an explicit table plus a `<name>_mv` writing into it, matching how
 * `clickmap_events` and `span_writes` already work here. The explicit table is
 * what lets the columns be upgraded later and lets a backfill be a plain INSERT,
 * and `trace_roots` needed a new sorting key anyway (see TRACE_ROOTS_COLUMNS).
 *
 * A materialized view cannot be the target of another materialized view, so the
 * old object has to go before the table can take its name. The engine check
 * keeps this from ever touching the real table on later boots — `DROP VIEW`
 * would throw on a MergeTree, and an unguarded `DROP TABLE` would delete
 * everything on every restart.
 */
async function dropImplicitStorageMaterializedView(client: ClickHouseClient, table: string): Promise<void> {
  const resultSet = await client.query({
    query: "SELECT engine FROM system.tables WHERE database = 'analytics_internal' AND name = {table:String}",
    query_params: { table },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ engine: string }>();
  if (rows.some((row) => row.engine === "MaterializedView")) {
    console.log(`[Clickhouse] Replacing legacy materialized view analytics_internal.${table} with an explicit table`);
    await client.command({ query: `DROP TABLE IF EXISTS analytics_internal.${table}` });
  }
}

/**
 * Drops a DERIVED table (one whose full content a later backfill can rebuild
 * from its source table) when it still carries a retired pre-release column.
 * Guarded on the legacy column actually existing so this can never touch a
 * current-shape table — an unguarded drop would wipe the read model on every
 * boot and re-trigger the backfill each time.
 */
export async function dropDerivedTableIfLegacyShape(
  client: ClickHouseClient,
  options: { database: string, table: string, legacyColumnName: string },
): Promise<boolean> {
  const resultSet = await client.query({
    query: "SELECT 1 AS present FROM system.columns WHERE database = {database:String} AND table = {table:String} AND name = {legacyColumnName:String}",
    query_params: { database: options.database, table: options.table, legacyColumnName: options.legacyColumnName },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ present: number }>();
  if (rows.length === 0) return false;
  console.log(`[Clickhouse] Dropping legacy-shaped derived table ${options.database}.${options.table} (will be rebuilt by the backfill)`);
  await client.command({ query: `DROP TABLE ${options.database}.${options.table}` });
  return true;
}

/**
 * Rebuilds a derived table when a newly required visibility column is absent.
 * Unlike ordinary source tables, preserving this table's rows would be
 * counterproductive: the backfill can restore every row with the new column,
 * while an ADD COLUMN would leave historical rows with an unusable default.
 */
export async function dropDerivedTableIfMissingColumn(
  client: ClickHouseClient,
  options: { database: string, table: string, requiredColumnName: string },
): Promise<boolean> {
  const resultSet = await client.query({
    query: `
SELECT
  count() AS column_count,
  countIf(name = {requiredColumnName:String}) AS required_column_count
FROM system.columns
WHERE database = {database:String} AND table = {table:String}
`,
    query_params: {
      database: options.database,
      table: options.table,
      requiredColumnName: options.requiredColumnName,
    },
    format: "JSONEachRow",
  });
  const [shape] = await resultSet.json<{ column_count: string, required_column_count: string }>();
  if (Number(shape.column_count) === 0 || Number(shape.required_column_count) !== 0) return false;
  console.log(`[Clickhouse] Dropping derived table ${options.database}.${options.table} without required column ${options.requiredColumnName} (will be rebuilt by the backfill)`);
  await client.command({ query: `DROP TABLE ${options.database}.${options.table}` });
  return true;
}

async function clickhouseTableExists(
  client: ClickHouseClient,
  options: { database: string, table: string },
): Promise<boolean> {
  const resultSet = await client.query({
    query: "SELECT count() AS count FROM system.tables WHERE database = {database:String} AND name = {table:String}",
    query_params: { database: options.database, table: options.table },
    format: "JSONEachRow",
  });
  const [row] = await resultSet.json<{ count: string }>();
  return Number(row.count) !== 0;
}

/**
 * Creates a materialized view, replacing a stale pre-release definition first.
 * `CREATE MATERIALIZED VIEW IF NOT EXISTS` never updates an existing view, and
 * a stale SELECT over renamed source columns fails every INSERT into the
 * source table — i.e. it breaks ingestion, not deployment. The staleness probe
 * runs over ClickHouse's stored (normalized) CREATE statement, so
 * `isUpToDate` must key on a marker that survives normalization — a column
 * name that only the current definition references.
 *
 * The drop-to-create window means source-table inserts racing this migration
 * are not captured by the view. Acceptable here: both users of this helper
 * (trace_roots_mv, span_writes_mv) only ever needed replacing on pre-release
 * deployments, and boot-time migrations do not run concurrently with traffic
 * on those.
 */
export async function ensureMaterializedViewUpToDate(
  client: ClickHouseClient,
  options: {
    database: string,
    name: string,
    isUpToDate: (createQuery: string) => boolean,
    createSql: string,
  },
): Promise<void> {
  const resultSet = await client.query({
    query: "SELECT create_table_query FROM system.tables WHERE database = {database:String} AND name = {name:String}",
    query_params: { database: options.database, name: options.name },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ create_table_query: string }>();
  if (rows.length > 0 && !options.isUpToDate(rows[0].create_table_query)) {
    console.log(`[Clickhouse] Replacing stale materialized view ${options.database}.${options.name}`);
    await client.command({ query: `DROP TABLE ${options.database}.${options.name}` });
  }
  await client.command({ query: options.createSql });
}

/**
 * Fills a derived read model with the spans that predate its materialized view.
 *
 * This replaces `POPULATE`, which drops any row inserted while it runs — a
 * silent, unrecoverable hole in the read model. Attaching the materialized view
 * first and then copying history means the two overlap instead of leaving a gap,
 * and the overlap is harmless: both targets are ReplacingMergeTrees keyed by the
 * span's identity, so a row written twice at the same `version` collapses.
 *
 * Guarded on the destination being empty, which makes it a one-shot. A fresh
 * install has no spans yet, so this is a no-op there; it only does work for a
 * database that accumulated spans before this read model existed.
 */
export async function backfillDerivedSpanTable(
  client: ClickHouseClient,
  options: { table: string, selectSql: string, database?: string, force?: boolean },
): Promise<void> {
  const database = options.database ?? "analytics_internal";
  const resultSet = await client.query({
    query: `SELECT count() AS count FROM ${database}.${options.table}`,
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ count: string }>();
  const existingCount = Number(rows[0]?.count ?? throwErr(`count() over ${database}.${options.table} returned no row`));
  if (!options.force && existingCount > 0) return;

  console.log(`[Clickhouse] Backfilling ${database}.${options.table} from existing spans`);
  await client.command({
    query: `INSERT INTO ${database}.${options.table}\n${options.selectSql}`,
  });
}

/**
 * Recreates an UNRELEASED telemetry table whose physical layout (engine or
 * partition key) changed since a dev/staging deployment first created it —
 * properties `ALTER TABLE` cannot change in place.
 *
 * Copy-and-swap: build the table under a temporary name with the current
 * canonical CREATE, copy every row over by explicit column list (so differing
 * physical column orders between vintages cannot mis-pair), then atomically
 * `EXCHANGE TABLES` (requires the Atomic database engine, the default) and drop
 * the now-renamed old table. Materialized views keep working across the swap
 * because they reference their source and target tables by name.
 *
 * This is explicitly NOT safe for released tables: rows inserted into the old
 * table between the copy and the exchange are lost, and the copy doubles the
 * table's disk usage while it runs. Both are acceptable for pre-release data
 * only — do not reuse this for a table that has shipped.
 *
 * Idempotent across crashes: the temporary table is dropped up front (a
 * leftover only ever holds an incomplete copy, or — if the crash happened after
 * the exchange — the obsolete layout), and the layout probe makes reruns
 * no-ops once the canonical layout is in place.
 */
export async function recreatePreReleaseTableIfLayoutChanged(
  client: ClickHouseClient,
  options: {
    database: string,
    table: string,
    needsRecreate: (info: { engine: string, partition_key: string, columnNames: readonly string[] }) => boolean,
    buildCreateSql: (fullTableName: string) => string,
    /** target column in the NEW table ← SQL expression evaluated over the OLD
     * table (usually just the same column name; a legacy-shape recreate maps
     * renamed columns and fills brand-new ones with literals). */
    copyColumns: readonly { target: string, sourceExpression: string }[],
  },
): Promise<boolean> {
  const fullName = `${options.database}.${options.table}`;
  const tmpName = `${options.database}.${options.table}__layout_migration`;
  await client.command({ query: `DROP TABLE IF EXISTS ${tmpName}` });

  const resultSet = await client.query({
    query: "SELECT engine, partition_key FROM system.tables WHERE database = {database:String} AND name = {table:String}",
    query_params: { database: options.database, table: options.table },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ engine: string, partition_key: string }>();
  // Absent table: a fresh database, whose CREATE produces the new layout directly.
  if (rows.length === 0) return false;
  // Column names are part of the probed layout so a recreate can also be keyed
  // on a legacy column set (renamed/cut columns), not just engine/partition.
  const columnsResultSet = await client.query({
    query: "SELECT name FROM system.columns WHERE database = {database:String} AND table = {table:String}",
    query_params: { database: options.database, table: options.table },
    format: "JSONEachRow",
  });
  const columnNames = (await columnsResultSet.json<{ name: string }>()).map((row) => row.name);
  if (!options.needsRecreate({ ...rows[0], columnNames })) return false;

  console.log(`[Clickhouse] Recreating ${fullName} for a changed physical table layout`);
  await client.command({ query: options.buildCreateSql(tmpName) });
  const targetList = options.copyColumns.map((column) => column.target).join(", ");
  const sourceList = options.copyColumns.map((column) => column.sourceExpression).join(", ");
  await client.command({ query: `INSERT INTO ${tmpName} (${targetList}) SELECT ${sourceList} FROM ${fullName}` });
  await client.command({ query: `EXCHANGE TABLES ${fullName} AND ${tmpName}` });
  await client.command({ query: `DROP TABLE ${tmpName}` });
  return true;
}

/**
 * Applies the retention TTL to a table that predates the TTL clause in its
 * CREATE statement. Guarded on the table's current metadata because re-running
 * `MODIFY TTL` is not free: with `materialize_ttl_after_modify` (deliberately
 * left at its default of 1) it schedules a background mutation over every part.
 * That one-shot mutation is wanted — without it, parts in cold partitions that
 * never merge again would keep expired rows forever — and it does not block
 * boot, so it is fine even for the production-sized events table.
 *
 * The probe matches ClickHouse's normalized form of the expression
 * (`INTERVAL n DAY` is stored as `toIntervalDay(n)`), so changing the retention
 * constant later re-triggers exactly one MODIFY TTL.
 */
export async function ensureTableTtl(
  client: ClickHouseClient,
  options: { database: string, table: string, ttlDays: number },
): Promise<void> {
  const resultSet = await client.query({
    query: "SELECT engine_full FROM system.tables WHERE database = {database:String} AND name = {table:String}",
    query_params: { database: options.database, table: options.table },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ engine_full: string }>();
  const engineFull = rows[0]?.engine_full ?? throwErr(`ensureTableTtl: table ${options.database}.${options.table} does not exist; it must be created before its TTL is ensured`);
  if (engineFull.includes(`toDateTime(created_at) + toIntervalDay(${options.ttlDays})`)) return;

  console.log(`[Clickhouse] Applying ${options.ttlDays}-day TTL to ${options.database}.${options.table}`);
  await client.command({
    query: `ALTER TABLE ${options.database}.${options.table} MODIFY TTL ${buildRetentionTtlSql(options.ttlDays)}`,
  });
}

/**
 * Adds a data-skipping index to a table that predates the INDEX clause in its
 * CREATE statement, and materializes it for parts written before the index
 * existed. `ADD INDEX` alone only covers future parts, which would make the
 * index useless for exactly the historical scans it is meant to prune.
 * MATERIALIZE INDEX is a background mutation that reads only the indexed
 * column(s), so it is acceptable one-time work even at production scale — but
 * only one-time, hence the guard on system.data_skipping_indices rather than
 * re-issuing it every boot.
 */
export async function ensureSkipIndex(
  client: ClickHouseClient,
  options: { database: string, table: string, indexName: string, indexDefinitionSql: string },
): Promise<void> {
  const resultSet = await client.query({
    query: "SELECT name FROM system.data_skipping_indices WHERE database = {database:String} AND table = {table:String} AND name = {indexName:String}",
    query_params: { database: options.database, table: options.table, indexName: options.indexName },
    format: "JSONEachRow",
  });
  const rows = await resultSet.json<{ name: string }>();
  if (rows.length > 0) return;

  console.log(`[Clickhouse] Adding skip index ${options.indexName} to ${options.database}.${options.table}`);
  await client.command({
    query: `ALTER TABLE ${options.database}.${options.table} ADD INDEX IF NOT EXISTS ${options.indexName} ${options.indexDefinitionSql}`,
  });
  await client.command({
    query: `ALTER TABLE ${options.database}.${options.table} MATERIALIZE INDEX ${options.indexName}`,
  });
}

// ─── Schema declarations ────────────────────────────────────────────
//
// Tables whose column list evolves over time, or that back a customer-facing
// `default.*` view, declare their columns exactly once below; the CREATE TABLE,
// the ADD COLUMN upgrade path, and the view's select list are all derived from
// that single declaration.
//
// Maintaining those three by hand is what let them drift: a column present in
// the CREATE TABLE but absent from the ALTER, or added by the ALTER in a
// different position, produced databases whose shape depended on when they were
// first created. Deriving all three removes that class of bug. (The tables
// replicated from Postgres by ext-db-sync, and the internal-only ledgers that
// have neither a view nor a history of column additions, stay as literal SQL.)
export type ClickhouseColumn = {
  name: string,
  type: string,
  default?: string,
};

// ─── Retention ──────────────────────────────────────────────────────
//
// Hard, platform-wide retention caps enforced ClickHouse-side via TTL, keyed on
// `created_at` (ingestion time) so re-upserted telemetry never expires earlier
// than its last write. Telemetry rows (events, spans, span links) keep 90 days.
// `span_writes` is the immutable billing ledger and must outlive every billing
// period it can be audited or disputed against, so it keeps 400 days (13
// monthly periods plus buffer). Per-plan configurable retention is a follow-up;
// these are the upper bounds it would tighten, never loosen.
export const TELEMETRY_TTL_DAYS = 90;
export const SPAN_WRITES_TTL_DAYS = 400;
export const TELEMETRY_INSERT_DEDUPLICATION_WINDOW = 10_000;
export const TELEMETRY_INSERT_TABLES = ["events", "logs", "spans"] as const;

export function buildTelemetryInsertDeduplicationSettingSql(
  table: typeof TELEMETRY_INSERT_TABLES[number],
): string {
  return `ALTER TABLE analytics_internal.${table} MODIFY SETTING non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`;
}

// `toDateTime(...)` (not the raw DateTime64) matches what ensureTableTtl probes
// for in the normalized table metadata; keep the two in sync.
function buildRetentionTtlSql(ttlDays: number): string {
  return `toDateTime(created_at) + INTERVAL ${ttlDays} DAY DELETE`;
}

function buildColumnDefinition(column: ClickhouseColumn): string {
  return `${column.name} ${column.type}${column.default == null ? "" : ` DEFAULT ${column.default}`}`;
}

function buildCreateTableSql(table: string, columns: readonly ClickhouseColumn[], engineClause: string, extraDeclarations: readonly string[] = []): string {
  return `
CREATE TABLE IF NOT EXISTS ${table} (
    ${[...columns.map(buildColumnDefinition), ...extraDeclarations].join(",\n    ")}
)
${engineClause};
`;
}

/**
 * Brings a database that predates some of `columns` up to the current shape.
 *
 * Each action names its predecessor, so replaying the full list against a
 * database missing an interior column inserts that column in its canonical
 * position rather than appending it wherever the ALTER happens to run.
 * `IF NOT EXISTS` makes the whole statement a no-op once a database is current,
 * which is the steady state on every boot.
 *
 * This positions only the columns it actually creates — a column that an earlier
 * revision already added somewhere else keeps its physical position. That is
 * fine (and why the reordering gymnastics are not worth it): the customer-facing
 * contract is the `default.*` view, which always enumerates its columns, so
 * physical order never leaks out.
 */
export function buildColumnUpgradeSql(table: string, columns: readonly ClickhouseColumn[]): string {
  const actions = columns.map((column, index) => {
    const position = index === 0 ? "FIRST" : `AFTER ${columns[index - 1].name}`;
    return `ADD COLUMN IF NOT EXISTS ${buildColumnDefinition(column)} ${position}`;
  });
  return `
ALTER TABLE ${table}
  ${actions.join(",\n  ")};
`;
}

/**
 * The column list for a `default.*` view. Views must never be `SELECT *`: two
 * deployments can reach the same logical schema with different physical column
 * orders, and `SELECT *` would then hand customers differently-shaped result
 * sets for the same query. It matters even more for the UNION ALL views, where
 * ClickHouse lines branches up by POSITION rather than by name — a `SELECT *`
 * branch can silently pair with the wrong same-typed column of another branch.
 */
export function selectColumnNames(columns: readonly ClickhouseColumn[], exclude: readonly string[] = []): string[] {
  const remaining = new Set(exclude);
  const names = columns.filter((column) => !remaining.delete(column.name)).map((column) => column.name);
  if (remaining.size > 0) {
    throw new Error(`Cannot exclude unknown analytics column(s) from a view: ${[...remaining].join(", ")}`);
  }
  return names;
}

function buildViewSelectList(columns: readonly ClickhouseColumn[], exclude: readonly string[] = []): string {
  return selectColumnNames(columns, exclude).join(",\n  ");
}

/**
 * Projects a derived read model's columns out of its source table's declaration
 * so the two cannot drift apart. A mismatched type between a materialized view's
 * SELECT and its target table is rejected at INSERT time (i.e. it breaks
 * ingestion, not deployment), which is exactly the kind of failure that should
 * be impossible to write rather than caught in review.
 */
function pickColumns(columns: readonly ClickhouseColumn[], names: readonly string[]): ClickhouseColumn[] {
  const byName = new Map(columns.map((column) => [column.name, column]));
  return names.map((name) => byName.get(name) ?? throwErr(`Unknown source column for derived analytics table: ${name}`));
}

// `created_at` (the ingestion timestamp) is deliberately LAST: it is the only
// column that existed before the telemetry columns were introduced and did
// not have a successor, so keeping it last means a pre-telemetry database
// upgraded via buildColumnUpgradeSql lands on exactly the same physical order as
// a freshly created one.
// `as const` (here and on the other telemetry column lists) keeps the column
// names as literal types so insert-row builders can be checked against
// `EventColumnName` and friends at compile time — see self-telemetry-spans.test.ts.
//
// `message`/`level` are the log fields (`$log` rows and backend-captured console
// output); non-log events leave them at their empty defaults. `producer` says
// WHO wrote the row ('sdk' = the customer's app via the Hexclave SDK,
// 'hexclave-backend' = Hexclave's own backend writing on the project's behalf:
// system events like $token-refresh, backend logs, span milestones). `runtime`
// says WHERE the producing code ran ('browser'/'server' for SDK rows, stamped
// by the batch route from the auth type; 'system' for everything Hexclave
// writes itself).
export const EVENTS_COLUMNS = [
  { name: "event_type", type: "LowCardinality(String)" },
  { name: "event_at", type: "DateTime64(3, 'UTC')" },
  { name: "message", type: "String", default: "''" },
  { name: "level", type: "LowCardinality(String)", default: "''" },
  { name: "data", type: "JSON" },
  { name: "producer", type: "LowCardinality(String)", default: "'hexclave-backend'" },
  { name: "runtime", type: "LowCardinality(String)", default: "'system'" },
  { name: "project_id", type: "String" },
  { name: "branch_id", type: "String" },
  { name: "user_id", type: "Nullable(String)" },
  { name: "team_id", type: "Nullable(String)" },
  { name: "refresh_token_id", type: "Nullable(String)" },
  { name: "session_replay_id", type: "Nullable(String)" },
  { name: "session_replay_segment_id", type: "Nullable(String)" },
  { name: "parent_span_ids", type: "Array(String)", default: "[]" },
  { name: "trace_id", type: "Nullable(String)" },
  { name: "span_id", type: "Nullable(String)" },
  { name: "service_namespace", type: "LowCardinality(Nullable(String))" },
  { name: "service_name", type: "LowCardinality(Nullable(String))" },
  { name: "service_version", type: "Nullable(String)" },
  { name: "service_instance_id", type: "Nullable(String)" },
  { name: "deployment_environment_name", type: "LowCardinality(Nullable(String))" },
  { name: "resource_attributes", type: "String", default: "'{}'" },
  { name: "created_at", type: "DateTime64(3, 'UTC')", default: "now64(3)" },
] as const satisfies readonly ClickhouseColumn[];

export type EventColumnName = (typeof EVENTS_COLUMNS)[number]["name"];

// Skip index on `event_type`: the logs UI restricts to `event_type = '$log'`
// (and event dashboards restrict to single types) while the sorting key only
// covers (project, branch, time), so without it those scans read every granule
// in the time range. `set(0)` stores the full per-granule value set, which
// stays small because event types are low-cardinality by construction (system
// types plus a bounded set of customer-defined names). A `producer` index was
// considered as the successor of the old `source` index and rejected: within a
// customer project virtually every row is producer='sdk', so it would prune
// nothing. Declared here AND applied to pre-existing tables via
// ensureSkipIndex, which also materializes it for historical parts.
export const EVENTS_EVENT_TYPE_INDEX_NAME = "idx_event_type";
export const EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL = "event_type TYPE set(0) GRANULARITY 4";

const EVENTS_TABLE_BASE_SQL = buildCreateTableSql("analytics_internal.events", EVENTS_COLUMNS, `
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (project_id, branch_id, event_at)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}`, [
  `INDEX ${EVENTS_EVENT_TYPE_INDEX_NAME} ${EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL}`,
]);

// Upgrades databases created before the telemetry columns existed. Clean
// databases get the identical shape straight from EVENTS_TABLE_BASE_SQL.
const EVENTS_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.events", EVENTS_COLUMNS);

// Logs and error occurrences share one log-shaped physical table. Errors keep
// exception metadata in `data`; Issues will aggregate those occurrences later.
export const LOGS_COLUMNS = EVENTS_COLUMNS;
export type LogColumnName = (typeof LOGS_COLUMNS)[number]["name"];
const LOGS_TABLE_BASE_SQL = buildCreateTableSql("analytics_internal.logs", LOGS_COLUMNS, `
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (project_id, branch_id, event_at)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}`, [
  `INDEX ${EVENTS_EVENT_TYPE_INDEX_NAME} ${EVENTS_EVENT_TYPE_INDEX_DEFINITION_SQL}`,
]);
const LOGS_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.logs", LOGS_COLUMNS);

export const SPAN_EVENTS_COLUMNS = EVENTS_COLUMNS;
export type SpanEventColumnName = (typeof SPAN_EVENTS_COLUMNS)[number]["name"];
const SPAN_EVENTS_TABLE_BASE_SQL = buildCreateTableSql("analytics_internal.span_events", SPAN_EVENTS_COLUMNS, `
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (project_id, branch_id, event_at)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}`);
const SPAN_EVENTS_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.span_events", SPAN_EVENTS_COLUMNS);

// Drops the never-released log/tracing columns that an intermediate revision of
// this (unmerged) telemetry work added to the events table on dev/staging
// deployments: the body/severity pair was replaced by `message`/`level`,
// `source` by `producer`, and the protocol-mirroring resource/scope/flag
// columns were cut entirely. Production databases predate all of these, so
// every action is an IF EXISTS no-op there. The old `idx_source` skip index
// must go in the same statement and BEFORE its column: ClickHouse refuses to
// drop a column a skip index still references.
// `as const` so the migration test can assert the cut-list stays disjoint from
// EVENTS_COLUMNS.
export const EVENTS_LEGACY_COLUMNS_TO_DROP = [
  "body",
  "severity_text",
  "severity_number",
  "trace_flags",
  "source",
  "resource_schema_url",
  "scope_name",
  "scope_version",
  "scope_attributes",
  "scope_schema_url",
  "dropped_attributes",
] as const;

export function buildEventsLegacyCleanupSql(table: string): string {
  return `
ALTER TABLE ${table}
  DROP INDEX IF EXISTS idx_source,
  ${EVENTS_LEGACY_COLUMNS_TO_DROP.map((column) => `DROP COLUMN IF EXISTS ${column}`).join(",\n  ")};
`;
}

const EVENTS_LEGACY_CLEANUP_SQL = buildEventsLegacyCleanupSql("analytics_internal.events");

// Physical events only. `$page-view` is a SPAN (see default.spans) — never
// project spans into this view or the traces UI shows the same fact twice
// (event diamond + span bar). Metrics that need page views query spans directly.
const EVENTS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.events
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(EVENTS_COLUMNS)}
FROM analytics_internal.events
WHERE event_type NOT IN ('$log', '$error');
`;

const LOGS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.logs
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(LOGS_COLUMNS)}
FROM analytics_internal.logs
WHERE event_type = '$log';
`;

const ERRORS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.errors
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(LOGS_COLUMNS)}
FROM analytics_internal.logs
WHERE event_type = '$error';
`;

const SPAN_EVENTS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.span_events
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(SPAN_EVENTS_COLUMNS)}
FROM analytics_internal.span_events;
`;

// Normalizes legacy $token-refresh rows (camelCase JSON) to the new format:
// - Row identity stays in columns (project_id/branch_id/user_id)
// - data JSON becomes { refresh_token_id, is_anonymous, ip_info } (snake_case)
// Assumption: all legacy rows have the camelCase format.
const TOKEN_REFRESH_EVENT_ROW_FORMAT_MUTATION_SQL = `
ALTER TABLE analytics_internal.events
UPDATE
  data = CAST(concat(
    '{',
      '"refresh_token_id":', toJSONString(data.refreshTokenId::String), ',',
      '"is_anonymous":', if(ifNull(data.isAnonymous::Nullable(Bool), false), 'true', 'false'), ',',
      '"ip_info":', if(
        isNull(data.ipInfo.ip::Nullable(String)),
        'null',
        concat(
          '{',
            '"ip":', toJSONString(data.ipInfo.ip::String), ',',
            '"is_trusted":', if(ifNull(data.ipInfo.isTrusted::Nullable(Bool), false), 'true', 'false'), ',',
            '"country_code":', if(isNull(data.ipInfo.countryCode::Nullable(String)), 'null', toJSONString(data.ipInfo.countryCode::String)), ',',
            '"region_code":', if(isNull(data.ipInfo.regionCode::Nullable(String)), 'null', toJSONString(data.ipInfo.regionCode::String)), ',',
            '"city_name":', if(isNull(data.ipInfo.cityName::Nullable(String)), 'null', toJSONString(data.ipInfo.cityName::String)), ',',
            '"latitude":', if(isNull(data.ipInfo.latitude::Nullable(Float64)), 'null', toString(data.ipInfo.latitude::Float64)), ',',
            '"longitude":', if(isNull(data.ipInfo.longitude::Nullable(Float64)), 'null', toString(data.ipInfo.longitude::Float64)), ',',
            '"tz_identifier":', if(isNull(data.ipInfo.tzIdentifier::Nullable(String)), 'null', toJSONString(data.ipInfo.tzIdentifier::String)),
          '}'
        )
      ),
    '}'
  ) AS JSON)
WHERE event_type = '$token-refresh'
  AND data.refreshTokenId::Nullable(String) IS NOT NULL;
`;

// Normalizes legacy $sign-up-rule-trigger rows (camelCase JSON) to the new format:
// - Row identity stays in columns (project_id/branch_id)
// - data JSON becomes { project_id, branch_id, rule_id, action, email, auth_method, oauth_provider } (snake_case)
const SIGN_UP_RULE_TRIGGER_EVENT_ROW_FORMAT_MUTATION_SQL = `
ALTER TABLE analytics_internal.events
UPDATE
  data = CAST(concat(
    '{',
      '"project_id":', toJSONString(JSONExtractString(toJSONString(data), 'projectId')), ',',
      '"branch_id":', toJSONString(JSONExtractString(toJSONString(data), 'branchId')), ',',
      '"rule_id":', toJSONString(JSONExtractString(toJSONString(data), 'ruleId')), ',',
      '"action":', toJSONString(JSONExtractString(toJSONString(data), 'action')), ',',
      '"email":', toJSONString(JSONExtract(toJSONString(data), 'email', 'Nullable(String)')), ',',
      '"auth_method":', toJSONString(JSONExtract(toJSONString(data), 'authMethod', 'Nullable(String)')), ',',
      '"oauth_provider":', toJSONString(JSONExtract(toJSONString(data), 'oauthProvider', 'Nullable(String)')),
    '}'
  ) AS JSON)
WHERE event_type = '$sign-up-rule-trigger'
  AND JSONHas(toJSONString(data), 'ruleId');
`;

const USERS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.users (
    project_id String,
    branch_id String,
    id UUID,
    display_name Nullable(String),
    profile_image_url Nullable(String),
    primary_email Nullable(String),
    primary_email_verified UInt8,
    signed_up_at DateTime64(3, 'UTC'),
    client_metadata String,
    client_read_only_metadata String,
    server_metadata String,
    is_anonymous UInt8,
    restricted_by_admin UInt8,
    restricted_by_admin_reason Nullable(String),
    restricted_by_admin_private_details Nullable(String),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(signed_up_at)
ORDER BY (project_id, branch_id, id);
`;

const USERS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.users 
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  display_name,
  profile_image_url,
  primary_email,
  primary_email_verified,
  signed_up_at,
  client_metadata,
  client_read_only_metadata,
  server_metadata,
  is_anonymous,
  restricted_by_admin,
  restricted_by_admin_reason,
  restricted_by_admin_private_details
FROM analytics_internal.users
FINAL
WHERE sync_is_deleted = 0;
`;

const SYNC_METADATA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal._stack_sync_metadata (
    tenancy_id UUID,
    mapping_name String,
    last_synced_sequence_id Int64,
    updated_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(updated_at)
ORDER BY (tenancy_id, mapping_name);
`;

// Backfill refresh_token_id from data.refresh_token_id for existing $token-refresh rows
const BACKFILL_REFRESH_TOKEN_ID_COLUMN_SQL = `
ALTER TABLE analytics_internal.events
UPDATE refresh_token_id = data.refresh_token_id::Nullable(String)
WHERE event_type = '$token-refresh'
  AND refresh_token_id IS NULL
  AND data.refresh_token_id::Nullable(String) IS NOT NULL;
`;

// Spans: telemetry siblings of events, written DIRECTLY to ClickHouse (never
// through ext-db-sync). `span_type` is the operation name (the SDK's
// `span_type` wire field; backend self-instrumentation stores its operation
// names here too), `data` is the span's structured payload as JSON, and
// `parent_span_ids` is Hexclave's single ancestry path, ordered from the
// farthest known ancestor to the immediate parent. SDK rows use Hexclave's
// globally unique typed ids; backend-produced rows use 16-hex ids whose
// uniqueness is scoped by trace_id (which is why trace_id is part of the
// sorting key).
//
// `producer` distinguishes WHO wrote the span: 'sdk' (the customer's app via
// the Hexclave SDK — the only billable producer, see SPAN_WRITES_MV_SQL) vs
// 'hexclave-backend' (Hexclave's own backend exporting its request handling
// into the customer's trace — always free). Every current writer stamps it
// explicitly; the 'sdk' default only matters for pre-release rows carried
// forward by the legacy-shape recreate below.
export const SPANS_COLUMNS = [
  { name: "trace_id", type: "String" },
  { name: "span_id", type: "String" },
  { name: "span_type", type: "LowCardinality(String)" },
  { name: "started_at", type: "DateTime64(3, 'UTC')" },
  { name: "ended_at", type: "Nullable(DateTime64(3, 'UTC'))" },
  { name: "parent_span_ids", type: "Array(String)", default: "[]" },
  { name: "kind", type: "LowCardinality(String)", default: "'internal'" },
  { name: "status_code", type: "LowCardinality(String)", default: "'unset'" },
  { name: "status_message", type: "Nullable(String)" },
  { name: "service_namespace", type: "LowCardinality(Nullable(String))" },
  { name: "service_name", type: "LowCardinality(Nullable(String))" },
  { name: "service_version", type: "Nullable(String)" },
  { name: "service_instance_id", type: "Nullable(String)" },
  { name: "deployment_environment_name", type: "LowCardinality(Nullable(String))" },
  { name: "resource_attributes", type: "String", default: "'{}'" },
  { name: "scope_name", type: "LowCardinality(Nullable(String))" },
  { name: "scope_version", type: "Nullable(String)" },
  { name: "data", type: "String", default: "'{}'" },
  { name: "producer", type: "LowCardinality(String)", default: "'sdk'" },
  { name: "project_id", type: "String" },
  { name: "branch_id", type: "String" },
  { name: "user_id", type: "Nullable(String)" },
  { name: "team_id", type: "Nullable(String)" },
  { name: "refresh_token_id", type: "Nullable(String)" },
  { name: "session_replay_id", type: "Nullable(String)" },
  { name: "session_replay_segment_id", type: "Nullable(String)" },
  { name: "created_at", type: "DateTime64(3, 'UTC')", default: "now64(3)" },
  { name: "version", type: "UInt64" },
] as const satisfies readonly ClickhouseColumn[];

export type SpanColumnName = (typeof SPANS_COLUMNS)[number]["name"];

// Column mapping for the pre-release recreate of a legacy-shaped spans table
// (see the recreatePreReleaseTableIfLayoutChanged call in
// runClickhouseMigrations): an intermediate revision of this unmerged branch
// named `span_type` "name" and `data` "attributes", and had no `producer`
// column. Every other retained column copies by its own name; the legacy-only
// protocol columns (trace_state, trace_flags, resource/scope schema URLs,
// scope_attributes, dropped_*) are dropped by not being selected. Old rows are
// stamped producer='sdk' — dev/staging-only data, and the copy never fires the
// billing materialized view, so the stamp cannot meter anything.
export const SPANS_RECREATE_COPY_COLUMNS: readonly { target: string, sourceExpression: string }[] = SPANS_COLUMNS.map((column) => ({
  target: column.name,
  sourceExpression: new Map([
    ["span_type", "name"],
    ["data", "attributes"],
    ["producer", "'sdk'"],
  ]).get(column.name) ?? column.name,
}));

// Partitioned by `started_at`, NOT by ingestion time: a ReplacingMergeTree's
// background merges never cross partitions, and `created_at` changes on every
// re-upsert of the same span — a span exported again in a later calendar month
// would land in a different partition and physically duplicate forever. SELECT
// ... FINAL happens to paper over that with default settings, but only by
// merge-sorting across partitions on every read, and it stops doing so under
// do_not_merge_across_partitions_select_final=1 — the standard FINAL
// optimization that a correctly-partitioned table is supposed to enable.
// `started_at` is immutable across re-upserts of one span identity (and matches
// how trace_roots is partitioned). Exported as a builder because the
// pre-release layout migration needs to create the same shape under a
// temporary name.
const SPANS_TABLE_ENGINE_SQL = `
ENGINE ReplacingMergeTree(version)
PARTITION BY toYYYYMM(started_at)
ORDER BY (project_id, branch_id, trace_id, span_id)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}
SETTINGS non_replicated_deduplication_window = ${TELEMETRY_INSERT_DEDUPLICATION_WINDOW}`;

export function buildSpansCreateTableSql(fullTableName: string): string {
  return buildCreateTableSql(fullTableName, SPANS_COLUMNS, SPANS_TABLE_ENGINE_SQL);
}

const SPANS_TABLE_BASE_SQL = buildSpansCreateTableSql("analytics_internal.spans");

const SPANS_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.spans", SPANS_COLUMNS);

// linked_trace_state/linked_trace_flags/dropped_attributes are retained
// physically for pre-release continuity but no writer populates them anymore
// (the trace-protocol concepts they mirrored were cut from the product model);
// the explicit DEFAULTs let insert rows omit them entirely.
export const SPAN_LINKS_COLUMNS = [
  { name: "project_id", type: "String" },
  { name: "branch_id", type: "String" },
  { name: "trace_id", type: "String" },
  { name: "owner_span_id", type: "String" },
  { name: "linked_trace_id", type: "String" },
  { name: "linked_span_id", type: "String" },
  { name: "linked_trace_state", type: "Nullable(String)", default: "NULL" },
  { name: "linked_trace_flags", type: "UInt32", default: "0" },
  { name: "attributes", type: "String", default: "'{}'" },
  { name: "dropped_attributes", type: "UInt32", default: "0" },
  { name: "created_at", type: "DateTime64(3, 'UTC')", default: "now64(3)" },
] as const satisfies readonly ClickhouseColumn[];

export type SpanLinkColumnName = (typeof SPAN_LINKS_COLUMNS)[number]["name"];

// ReplacingMergeTree keyed by the link's full identity (the entire ORDER BY):
// the backend's self-instrumentation export is at-least-once, so a retried
// batch re-inserts identical links, and a plain MergeTree kept every copy. `created_at` as the version
// column makes which duplicate survives deterministic (the latest write).
// Known limitation, accepted as rare: dedup cannot cross partitions, so a
// retry that straddles a `created_at` month boundary keeps both copies — links
// have no client-supplied timestamp that could partition them stably.
const SPAN_LINKS_TABLE_ENGINE_SQL = `
ENGINE ReplacingMergeTree(created_at)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, trace_id, owner_span_id, linked_trace_id, linked_span_id)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}`;

export function buildSpanLinksCreateTableSql(fullTableName: string): string {
  return buildCreateTableSql(fullTableName, SPAN_LINKS_COLUMNS, SPAN_LINKS_TABLE_ENGINE_SQL);
}

const SPAN_LINKS_TABLE_SQL = buildSpanLinksCreateTableSql("analytics_internal.span_links");

const SPAN_LINKS_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.span_links", SPAN_LINKS_COLUMNS);

// Root spans are a tiny, time-ordered read model for the trace inbox. The main
// spans table is ordered by trace/span identity for point lookup and contains
// every auto-instrumented child, so asking it for recent roots would require
// FINAL-merging tens of millions of rows before applying the time/parent filters.
//
// The columns are picked out of SPANS_COLUMNS rather than restated so the types
// cannot drift from the source table — which would break the materialized
// view's positional INSERT.
//
// `trace_id` belongs in the sorting key even though the inbox never filters on
// it: this is a ReplacingMergeTree, and a backend-produced span id is unique
// only WITHIN its trace, so a key without trace_id would let two unrelated root
// spans that happen to share a span id collapse into a single row. It sits
// after `span_id` so the (project_id, branch_id, started_at) prefix still
// serves the inbox's keyset pagination.
export const TRACE_ROOTS_COLUMNS: readonly ClickhouseColumn[] = pickColumns(SPANS_COLUMNS, [
  "trace_id",
  "span_id",
  "span_type",
  "started_at",
  "ended_at",
  "kind",
  "status_code",
  "data",
  "service_namespace",
  "service_name",
  "service_version",
  "deployment_environment_name",
  "scope_name",
  "project_id",
  "branch_id",
  "user_id",
  "refresh_token_id",
  "session_replay_id",
  "session_replay_segment_id",
  "created_at",
  "version",
]);

// Same retention as the source spans table: these are derived read models, and
// without their own TTL their rows would outlive the spans they were derived
// from, leaving the trace inbox listing traces whose spans are already gone.
// The TTL is keyed on `created_at` like spans (trace_roots copies the span's
// `created_at`), so a root row expires at the same time as its span row.
export function buildTraceRootsCreateTableSql(fullTableName: string): string {
  return buildCreateTableSql(fullTableName, TRACE_ROOTS_COLUMNS, `
ENGINE ReplacingMergeTree(version)
PARTITION BY toYYYYMM(started_at)
ORDER BY (project_id, branch_id, started_at, span_id, trace_id)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}`);
}

const TRACE_ROOTS_TABLE_SQL = buildTraceRootsCreateTableSql("analytics_internal.trace_roots");

const TRACE_ROOTS_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.trace_roots", TRACE_ROOTS_COLUMNS);

// Next runs middleware in a detached context, CORS preflights have no incoming
// traceparent, and startResponse can run after the request context is gone.
// Those spans are physically unparented but are framework lifecycle fragments,
// not useful trace-inbox entries. Keep them in spans for diagnostics without
// presenting them as independent traces.
export const TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL = `
span_type != '$http-client'
  AND NOT (
    coalesce(scope_name, '') = 'next.js'
    AND (kind = 'internal' OR span_type = 'OPTIONS')
  )
`.trim();

// The SELECT feeding trace_roots, shared by the materialized view and the
// one-shot backfill so the two can never disagree about what a visible root is.
export const TRACE_ROOTS_SOURCE_SELECT_SQL = `
SELECT
  ${buildViewSelectList(TRACE_ROOTS_COLUMNS)}
FROM analytics_internal.spans
WHERE empty(parent_span_ids)
  AND ${TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL}
`;

const TRACE_ROOTS_MV_SQL = `
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_internal.trace_roots_mv
TO analytics_internal.trace_roots
AS
${TRACE_ROOTS_SOURCE_SELECT_SQL};
`;

// One row per service participating in a trace. Filtering only by the root
// span's service would hide distributed traces rooted in another service, so
// this intentionally indexes every participating service.
//
// service_namespace/service_name are coalesced to '' rather than kept nullable
// because they are part of the sorting key, and NULLs in a key make the
// "which traces did service X touch" lookup awkward. The public view maps ''
// back to NULL for namespace.
export const TRACE_SERVICES_COLUMNS: readonly ClickhouseColumn[] = [
  { name: "project_id", type: "String" },
  { name: "branch_id", type: "String" },
  { name: "trace_id", type: "String" },
  { name: "service_namespace", type: "String" },
  { name: "service_name", type: "String" },
  // Exists solely to key the retention TTL the same way as the spans table
  // (copied from the source span's `created_at`, i.e. ingestion time). It is
  // NOT the ReplacingMergeTree version column — `version` (the span's ended_at)
  // keeps that job so re-exported spans still dedupe deterministically.
  { name: "created_at", type: "DateTime64(3, 'UTC')", default: "now64(3)" },
  { name: "version", type: "UInt64" },
];

// Same retention rationale as trace_roots: without a TTL these derived rows
// would outlive the spans they index.
export function buildTraceServicesCreateTableSql(fullTableName: string): string {
  return buildCreateTableSql(fullTableName, TRACE_SERVICES_COLUMNS, `
ENGINE ReplacingMergeTree(version)
ORDER BY (project_id, branch_id, service_namespace, service_name, trace_id)
TTL ${buildRetentionTtlSql(TELEMETRY_TTL_DAYS)}`);
}

const TRACE_SERVICES_TABLE_SQL = buildTraceServicesCreateTableSql("analytics_internal.trace_services");

const TRACE_SERVICES_SCHEMA_UPGRADE_SQL = buildColumnUpgradeSql("analytics_internal.trace_services", TRACE_SERVICES_COLUMNS);

// The output column order must match TRACE_SERVICES_COLUMNS exactly: the
// backfill runs this as a positional `INSERT INTO ... SELECT`.
//
// Known, accepted divergence for pre-release databases: an existing
// trace_services_mv was created from an earlier revision of this SELECT
// (without `created_at`) and `CREATE MATERIALIZED VIEW IF NOT EXISTS` will not
// update it, so its inserts fall back to the column's now64(3) default. That is
// the same ingestion-time semantics, just measured at the trace_services write
// instead of the span write — a sub-second difference that cannot matter for a
// 90-day TTL.
export const TRACE_SERVICES_SOURCE_SELECT_SQL = `
SELECT
  project_id,
  branch_id,
  trace_id,
  coalesce(service_namespace, '') AS service_namespace,
  coalesce(service_name, '') AS service_name,
  created_at,
  version
FROM analytics_internal.spans
WHERE service_name IS NOT NULL
`;

const TRACE_SERVICES_MV_SQL = `
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_internal.trace_services_mv
TO analytics_internal.trace_services
AS
${TRACE_SERVICES_SOURCE_SELECT_SQL};
`;

// Immutable billing ledger for custom-span writes. The source spans table is a
// ReplacingMergeTree whose old versions disappear during background merges, so
// it cannot answer how many writes were accepted during a billing period. The
// materialized view records one row for every custom-span row inserted while
// excluding the free $-prefixed system spans.
// Builders take the database name so the migration test can exercise the real
// billing filter against a throwaway database.
export function buildSpanWritesCreateTableSql(database: string): string {
  return `
CREATE TABLE IF NOT EXISTS ${database}.span_writes (
    project_id String,
    created_at DateTime64(3, 'UTC')
)
ENGINE MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, created_at)
TTL ${buildRetentionTtlSql(SPAN_WRITES_TTL_DAYS)};
`;
}

const SPAN_WRITES_TABLE_SQL = buildSpanWritesCreateTableSql("analytics_internal");

// Meters ONLY `producer = 'sdk'` writes: the backend's self-instrumentation
// exports its own request spans into the customer's project (that is the
// product feature — Hexclave's API side of the customer's trace), and billing
// the customer for spans Hexclave itself decided to write would let our
// sampling/instrumentation choices silently move their bill. `$`-prefixed
// system spans stay free for the same reason: the SDK mints them automatically
// and the interaction is already metered via its event counterpart. This
// filter must stay in lockstep with the accept-time debit in the events/batch
// route, which only charges non-`$` SDK spans.
export function buildSpanWritesMvSql(database: string): string {
  return `
CREATE MATERIALIZED VIEW IF NOT EXISTS ${database}.span_writes_mv
TO ${database}.span_writes
AS
SELECT project_id, created_at
FROM ${database}.spans
WHERE producer = 'sdk' AND NOT startsWith(span_type, '$');
`;
}

const SPAN_WRITES_MV_SQL = buildSpanWritesMvSql("analytics_internal");

// Refresh tokens are synced dimensions rather than telemetry writes. Define
// their span projection once, then reuse it in both public read models so trace
// detail and root pagination cannot drift.
//
// The alias order here must match SPANS_COLUMNS (minus `version`, which is an
// internal ReplacingMergeTree detail and not part of the public view), because
// ClickHouse resolves UNION ALL branches positionally. Several neighbouring
// columns share a type, so a reordering would silently mis-pair rather than
// error — REFRESH_TOKEN_SPAN_SELECT_ALIASES pins it down and the unit test for
// this file asserts the two agree.
//
// Query-cost note (verified via EXPLAIN indexes=1 on ClickHouse 25.10): outer
// predicates on `default.spans` / `default.trace_roots` — including the
// limited_user row policy's project_id/branch_id conditions — ARE pushed down
// into this UNION ALL branch, and the project_id/branch_id part uses the
// refresh_tokens primary-key prefix, so every customer query already prunes
// this branch to the tenant's own tokens. What can NOT use the primary key is
// an id equality like `trace_id = 'rti-…'`, because trace_id here is the
// computed `concat('rti-', id)`; such point lookups filter-scan the tenant's
// refresh tokens under FINAL. Internal callers doing point lookups should
// therefore always carry the project_id/branch_id prefilter; anything beyond
// that (e.g. rewriting rti- equalities to `id = …`) requires materializing
// this projection into the spans table, which is a deliberate follow-up.
export const REFRESH_TOKEN_SPAN_SELECT_SQL = `
SELECT
  concat('rti-', toString(id)) AS trace_id,
  concat('rti-', toString(id)) AS span_id,
  CAST('$refresh-token', 'LowCardinality(String)') AS span_type,
  created_at AS started_at,
  expires_at AS ended_at,
  CAST([], 'Array(String)') AS parent_span_ids,
  CAST('internal', 'LowCardinality(String)') AS kind,
  CAST('unset', 'LowCardinality(String)') AS status_code,
  CAST(NULL, 'Nullable(String)') AS status_message,
  CAST(NULL, 'LowCardinality(Nullable(String))') AS service_namespace,
  CAST(NULL, 'LowCardinality(Nullable(String))') AS service_name,
  CAST(NULL, 'Nullable(String)') AS service_version,
  CAST(NULL, 'Nullable(String)') AS service_instance_id,
  CAST(NULL, 'LowCardinality(Nullable(String))') AS deployment_environment_name,
  CAST('{}', 'String') AS resource_attributes,
  CAST(NULL, 'LowCardinality(Nullable(String))') AS scope_name,
  CAST(NULL, 'Nullable(String)') AS scope_version,
  CAST('{}', 'String') AS data,
  CAST('sdk', 'LowCardinality(String)') AS producer,
  project_id,
  branch_id,
  CAST(toString(user_id), 'Nullable(String)') AS user_id,
  CAST(NULL, 'Nullable(String)') AS team_id,
  CAST(toString(id), 'Nullable(String)') AS refresh_token_id,
  CAST(NULL, 'Nullable(String)') AS session_replay_id,
  CAST(NULL, 'Nullable(String)') AS session_replay_segment_id,
  sync_created_at AS created_at
FROM analytics_internal.refresh_tokens FINAL
WHERE sync_is_deleted = 0
`;

// Kept next to the SELECT above so a column added there without an alias, or
// aliased in the wrong position, fails the unit test instead of silently
// mis-pairing inside a UNION ALL.
//
// producer='sdk' here even though the row is synthesized server-side: the
// refresh-token span REPRESENTS the customer's own session (SDK-owned
// telemetry, like the replay/segment spans it parents), not backend
// self-instrumentation. It cannot affect billing either way — span_writes_mv
// only observes physical inserts into analytics_internal.spans, and this
// projection never inserts.
export const REFRESH_TOKEN_SPAN_SELECT_ALIASES: readonly string[] = [
  "trace_id",
  "span_id",
  "span_type",
  "started_at",
  "ended_at",
  "parent_span_ids",
  "kind",
  "status_code",
  "status_message",
  "service_namespace",
  "service_name",
  "service_version",
  "service_instance_id",
  "deployment_environment_name",
  "resource_attributes",
  "scope_name",
  "scope_version",
  "data",
  "producer",
  "project_id",
  "branch_id",
  "user_id",
  "team_id",
  "refresh_token_id",
  "session_replay_id",
  "session_replay_segment_id",
  "created_at",
];

// Customer-facing spans surface. UNION ALL of: (1) the physical spans table
// and (2) the canonical refresh-token span projection above.
const SPANS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.spans
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(SPANS_COLUMNS, ["version"])}
FROM analytics_internal.spans FINAL

UNION ALL

${REFRESH_TOKEN_SPAN_SELECT_SQL};
`;

// FINAL so links re-inserted by at-least-once export retries read as one link
// even before background merges collapse them (see SPAN_LINKS_TABLE_ENGINE_SQL).
const SPAN_LINKS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.span_links
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(SPAN_LINKS_COLUMNS)}
FROM analytics_internal.span_links FINAL;
`;

export const TRACE_ROOTS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.trace_roots
SQL SECURITY DEFINER
AS
SELECT
  ${buildViewSelectList(TRACE_ROOTS_COLUMNS, ["version"])}
FROM analytics_internal.trace_roots FINAL
WHERE ${TRACE_ROOTS_VISIBLE_ROOT_PREDICATE_SQL}

UNION ALL

-- SDK traces begin at the authenticated session boundary. Refresh tokens are
-- dimensions rather than telemetry writes, so project one canonical virtual
-- root per session instead of promoting an arbitrary parented SDK child.
SELECT
  ${buildViewSelectList(TRACE_ROOTS_COLUMNS, ["version"])}
FROM (
  ${REFRESH_TOKEN_SPAN_SELECT_SQL}
);
`;

const TRACE_SERVICES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.trace_services
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  trace_id,
  nullIf(service_namespace, '') AS service_namespace,
  service_name
FROM analytics_internal.trace_services FINAL;
`;

const CONTACT_CHANNELS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.contact_channels (
    project_id String,
    branch_id String,
    id UUID,
    user_id UUID,
    type LowCardinality(String),
    value String,
    is_primary UInt8,
    is_verified UInt8,
    used_for_auth UInt8,
    created_at DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const CONTACT_CHANNELS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.contact_channels
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  user_id,
  type,
  value,
  is_primary,
  is_verified,
  used_for_auth,
  created_at
FROM analytics_internal.contact_channels
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAMS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.teams (
    project_id String,
    branch_id String,
    id UUID,
    display_name String,
    profile_image_url Nullable(String),
    created_at DateTime64(3, 'UTC'),
    client_metadata String,
    client_read_only_metadata String,
    server_metadata String,
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const TEAMS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.teams
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  display_name,
  profile_image_url,
  created_at,
  client_metadata,
  client_read_only_metadata,
  server_metadata
FROM analytics_internal.teams
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAM_MEMBER_PROFILES_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.team_member_profiles (
    project_id String,
    branch_id String,
    team_id UUID,
    user_id UUID,
    display_name Nullable(String),
    profile_image_url Nullable(String),
    created_at DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, team_id, user_id);
`;

const TEAM_MEMBER_PROFILES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.team_member_profiles
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  team_id,
  user_id,
  display_name,
  profile_image_url,
  created_at
FROM analytics_internal.team_member_profiles
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAM_PERMISSIONS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.team_permissions (
    project_id       String,
    branch_id        String,
    team_id          UUID,
    user_id          UUID,
    id               String,
    created_at       DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted  UInt8,
    sync_created_at  DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, team_id, user_id, id);
`;

const TEAM_PERMISSIONS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.team_permissions
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  team_id,
  user_id,
  id,
  created_at
FROM analytics_internal.team_permissions
FINAL
WHERE sync_is_deleted = 0;
`;

const TEAM_INVITATIONS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.team_invitations (
    project_id         String,
    branch_id          String,
    id                 UUID,
    team_id            UUID,
    team_display_name  String,
    recipient_email    String,
    expires_at_millis  Int64,
    created_at         DateTime64(3, 'UTC'),
    sync_sequence_id   Int64,
    sync_is_deleted    UInt8,
    sync_created_at    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const TEAM_INVITATIONS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.team_invitations
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  team_id,
  team_display_name,
  recipient_email,
  expires_at_millis,
  created_at
FROM analytics_internal.team_invitations
FINAL
WHERE sync_is_deleted = 0;
`;

const EMAIL_OUTBOXES_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.email_outboxes (
    project_id String,
    branch_id String,
    id UUID,
    status LowCardinality(String),
    simple_status LowCardinality(String),
    created_with LowCardinality(String),
    email_draft_id Nullable(String),
    email_programmatic_call_template_id Nullable(String),
    theme_id Nullable(String),
    is_high_priority UInt8,
    is_transactional Nullable(UInt8),
    subject Nullable(String),
    notification_category_id Nullable(String),
    started_rendering_at Nullable(DateTime64(3, 'UTC')),
    rendered_at Nullable(DateTime64(3, 'UTC')),
    render_error Nullable(String),
    scheduled_at DateTime64(3, 'UTC'),
    created_at DateTime64(3, 'UTC'),
    updated_at DateTime64(3, 'UTC'),
    started_sending_at Nullable(DateTime64(3, 'UTC')),
    server_error Nullable(String),
    delivered_at Nullable(DateTime64(3, 'UTC')),
    opened_at Nullable(DateTime64(3, 'UTC')),
    clicked_at Nullable(DateTime64(3, 'UTC')),
    unsubscribed_at Nullable(DateTime64(3, 'UTC')),
    marked_as_spam_at Nullable(DateTime64(3, 'UTC')),
    bounced_at Nullable(DateTime64(3, 'UTC')),
    delivery_delayed_at Nullable(DateTime64(3, 'UTC')),
    can_have_delivery_info Nullable(UInt8),
    skipped_reason LowCardinality(Nullable(String)),
    skipped_details Nullable(String),
    send_retries Int32,
    is_paused UInt8,
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const EMAIL_OUTBOXES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.email_outboxes
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  status,
  simple_status,
  created_with,
  email_draft_id,
  email_programmatic_call_template_id,
  theme_id,
  is_high_priority,
  is_transactional,
  subject,
  notification_category_id,
  started_rendering_at,
  rendered_at,
  render_error,
  scheduled_at,
  created_at,
  updated_at,
  started_sending_at,
  server_error,
  delivered_at,
  opened_at,
  clicked_at,
  unsubscribed_at,
  marked_as_spam_at,
  bounced_at,
  delivery_delayed_at,
  can_have_delivery_info,
  skipped_reason,
  skipped_details,
  send_retries,
  is_paused
FROM analytics_internal.email_outboxes
FINAL
WHERE sync_is_deleted = 0;
`;


const PROJECT_PERMISSIONS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.project_permissions (
    project_id       String,
    branch_id        String,
    user_id          UUID,
    id               String,
    created_at       DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted  UInt8,
    sync_created_at  DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, user_id, id);
`;

const PROJECT_PERMISSIONS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.project_permissions
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  user_id,
  id,
  created_at
FROM analytics_internal.project_permissions
FINAL
WHERE sync_is_deleted = 0;
`;

const NOTIFICATION_PREFERENCES_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.notification_preferences (
    project_id             String,
    branch_id              String,
    user_id                UUID,
    notification_category_id String,
    enabled                UInt8,
    sync_sequence_id       Int64,
    sync_is_deleted        UInt8,
    sync_created_at        DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
ORDER BY (project_id, branch_id, user_id, notification_category_id);
`;

const NOTIFICATION_PREFERENCES_VIEW_SQL = `
CREATE OR REPLACE VIEW default.notification_preferences
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  user_id,
  notification_category_id,
  enabled
FROM analytics_internal.notification_preferences
FINAL
WHERE sync_is_deleted = 0;
`;

const REFRESH_TOKENS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.refresh_tokens (
    project_id String,
    branch_id String,
    id UUID,
    user_id UUID,
    created_at DateTime64(3, 'UTC'),
    last_used_at DateTime64(3, 'UTC'),
    is_impersonation UInt8,
    expires_at Nullable(DateTime64(3, 'UTC')),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, id);
`;

const REFRESH_TOKENS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.refresh_tokens
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  id,
  user_id,
  created_at,
  last_used_at,
  is_impersonation,
  expires_at
FROM analytics_internal.refresh_tokens
FINAL
WHERE sync_is_deleted = 0;
`;

const CONNECTED_ACCOUNTS_TABLE_BASE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.connected_accounts (
    project_id String,
    branch_id String,
    user_id UUID,
    provider String,
    provider_account_id String,
    created_at DateTime64(3, 'UTC'),
    sync_sequence_id Int64,
    sync_is_deleted UInt8,
    sync_created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE ReplacingMergeTree(sync_sequence_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (project_id, branch_id, user_id, provider, provider_account_id);
`;

const CONNECTED_ACCOUNTS_VIEW_SQL = `
CREATE OR REPLACE VIEW default.connected_accounts
SQL SECURITY DEFINER
AS
SELECT
  project_id,
  branch_id,
  user_id,
  provider,
  provider_account_id,
  created_at
FROM analytics_internal.connected_accounts
FINAL
WHERE sync_is_deleted = 0;
`;

// ─── Column comments ────────────────────────────────────────────────
// Applied to the default.* views after creation so that DESCRIBE TABLE
// returns useful descriptions for each column. The AI assistant uses
// SHOW TABLES + DESCRIBE TABLE for schema discovery instead of
// hardcoded schema in the prompt.
const COLUMN_COMMENT_STATEMENTS: string[] = [
  // ── events ──
  `ALTER TABLE default.events COMMENT COLUMN event_type 'Event type identifier. Known system types: \$click, \$form-submit, \$window-resize, \$copy, \$cut, \$paste, \$context-menu, \$print, \$fullscreen-exit, \$token-refresh, \$sign-up-rule-trigger, \$log (log lines), \$error (captured errors); other values are customer-defined custom events. Page views are NOT events — query default.spans WHERE span_type = \$page-view'`,
  `ALTER TABLE default.events COMMENT COLUMN event_at 'When the event occurred (UTC)'`,
  `ALTER TABLE default.events COMMENT COLUMN message 'Human-readable log text for \$log events (explicit logger calls and auto-captured console output). Empty for events that only carry structured data'`,
  `ALTER TABLE default.events COMMENT COLUMN level 'Log level for \$log events: trace, debug, info, warn, or error. Empty for non-log events'`,
  `ALTER TABLE default.events COMMENT COLUMN data 'Event payload as JSON. MUST use toString(data) before JSONExtract* functions. Payload varies by event_type: \$click → {is_anonymous, selector, url, viewport_width, viewport_height, x, y, ...}; \$token-refresh → {is_anonymous, refresh_token_id, ip_info: {country_code, city_name, region_code, is_trusted, latitude, longitude, tz_identifier, ip}}'`,
  `ALTER TABLE default.events COMMENT COLUMN producer 'Who wrote the row: sdk = the application via the Hexclave SDK; hexclave-backend = Hexclave itself on the project behalf (system events like \$token-refresh, platform-produced logs)'`,
  `ALTER TABLE default.events COMMENT COLUMN runtime 'Where the producing code ran: browser (client-side SDK), server (server-side SDK), or system (written by Hexclave itself)'`,
  `ALTER TABLE default.events COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.events COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.events COMMENT COLUMN user_id 'User who triggered the event. NULL for rows that are not attributable to a user'`,
  `ALTER TABLE default.events COMMENT COLUMN team_id 'Reserved for future use. Currently always NULL — do not filter on this column'`,
  `ALTER TABLE default.events COMMENT COLUMN created_at 'When this record was inserted into the database (UTC)'`,
  `ALTER TABLE default.events COMMENT COLUMN refresh_token_id 'The session (refresh token) this event happened in, when known'`,
  `ALTER TABLE default.events COMMENT COLUMN session_replay_id 'Session replay identifier for linking to replay recordings'`,
  `ALTER TABLE default.events COMMENT COLUMN session_replay_segment_id 'Segment within a session replay recording'`,
  `ALTER TABLE default.events COMMENT COLUMN parent_span_ids 'One ancestry path ordered from the farthest known ancestor to the immediate or owning span. SDK-produced ids carry their rti-/sri-/srsi-/pv-/cs-/hc- kind prefix; backend-produced ids are 16-hex and scoped by trace_id. Match rows in default.spans by trace_id and span_id'`,
  `ALTER TABLE default.events COMMENT COLUMN trace_id 'The trace this event belongs to, when known'`,
  `ALTER TABLE default.events COMMENT COLUMN span_id 'The exact span this event happened on, when known. Kept separate from parent_span_ids because prefixed SDK ancestry ids and backend span ids live in different namespaces'`,
  `ALTER TABLE default.events COMMENT COLUMN service_namespace 'Logical grouping the sending service reported for itself, when reported'`,
  `ALTER TABLE default.events COMMENT COLUMN service_name 'Name of the service that produced the event. Required for SDK-produced rows; NULL only for service-neutral platform-derived rows'`,
  `ALTER TABLE default.events COMMENT COLUMN service_version 'Version of the sending service, when reported'`,
  `ALTER TABLE default.events COMMENT COLUMN service_instance_id 'Identifier of the specific service instance that produced the event, when reported'`,
  `ALTER TABLE default.events COMMENT COLUMN deployment_environment_name 'Deployment environment reported by the sending service (e.g. production, staging), when reported'`,
  `ALTER TABLE default.events COMMENT COLUMN resource_attributes 'Additional resource metadata reported by the sending service, as JSON string. Common service and deployment identity fields have dedicated columns'`,

  // ── spans ──
  `ALTER TABLE default.spans COMMENT COLUMN trace_id 'Identity shared by every span in one trace. SDK-produced traces use their typed root span id; backend-produced traces use a 32-hex lowercase id'`,
  `ALTER TABLE default.spans COMMENT COLUMN span_id 'Span identity. SDK-produced rows use their globally unique typed rti-/sri-/srsi-/pv-/cs-/hc- id; backend-produced rows use a 16-hex id scoped by trace_id'`,
  `ALTER TABLE default.spans COMMENT COLUMN span_type 'What kind of operation the span represents: system types like \$page-view, \$http-client, \$refresh-token, \$session-replay, or a customer-defined span name; backend-produced spans store their operation name here'`,
  `ALTER TABLE default.spans COMMENT COLUMN started_at 'When the span started (UTC)'`,
  `ALTER TABLE default.spans COMMENT COLUMN ended_at 'When the span ended (UTC). NULL while it is still open'`,
  `ALTER TABLE default.spans COMMENT COLUMN parent_span_ids 'One ancestry path ordered from the farthest known ancestor to the immediate parent. The first entry may not be the absolute trace root when earlier ancestors were unavailable or truncated'`,
  `ALTER TABLE default.spans COMMENT COLUMN kind 'Role of the span in a request flow: internal, server, client, producer, or consumer'`,
  `ALTER TABLE default.spans COMMENT COLUMN status_code 'Outcome of the operation: ok, error, or unset when the producer did not report one'`,
  `ALTER TABLE default.spans COMMENT COLUMN status_message 'Optional error/status description accompanying status_code'`,
  `ALTER TABLE default.spans COMMENT COLUMN data 'Structured span payload as JSON string. Use JSONExtract* functions directly (e.g. JSONExtractString(data, path))'`,
  `ALTER TABLE default.spans COMMENT COLUMN producer 'Who wrote the span: sdk = the application via the Hexclave SDK; hexclave-backend = Hexclave own backend contributing its side of the trace'`,
  `ALTER TABLE default.spans COMMENT COLUMN service_namespace 'Logical grouping the sending service reported for itself, when reported'`,
  `ALTER TABLE default.spans COMMENT COLUMN service_name 'Name of the service that produced the span. Required for SDK-produced physical spans; NULL only for service-neutral platform-derived spans'`,
  `ALTER TABLE default.spans COMMENT COLUMN service_version 'Version of the sending service, when reported'`,
  `ALTER TABLE default.spans COMMENT COLUMN service_instance_id 'Identifier of the specific service instance that produced the span, when reported'`,
  `ALTER TABLE default.spans COMMENT COLUMN deployment_environment_name 'Deployment environment reported by the sending service (e.g. production, staging), when reported'`,
  `ALTER TABLE default.spans COMMENT COLUMN resource_attributes 'Additional environment metadata reported by the sending service, as JSON string. Common service and deployment identity fields have dedicated columns'`,
  `ALTER TABLE default.spans COMMENT COLUMN scope_name 'Name of the instrumentation component inside the sending service that produced the span, when reported'`,
  `ALTER TABLE default.spans COMMENT COLUMN scope_version 'Version of the instrumentation component that produced the span, when reported'`,
  `ALTER TABLE default.spans COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.spans COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.spans COMMENT COLUMN user_id 'User the span is attributed to, when known'`,
  `ALTER TABLE default.spans COMMENT COLUMN team_id 'Reserved for future use. Currently always NULL — do not filter on this column'`,
  `ALTER TABLE default.spans COMMENT COLUMN refresh_token_id 'The session (refresh token) the span happened in, when known'`,
  `ALTER TABLE default.spans COMMENT COLUMN session_replay_id 'Session replay identifier for linking to replay recordings'`,
  `ALTER TABLE default.spans COMMENT COLUMN session_replay_segment_id 'Segment within a session replay recording'`,
  `ALTER TABLE default.spans COMMENT COLUMN created_at 'When this record was inserted into the database (UTC)'`,

  // ── users ──
  `ALTER TABLE default.users COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.users COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.users COMMENT COLUMN id 'Unique user identifier (UUID primary key)'`,
  `ALTER TABLE default.users COMMENT COLUMN display_name 'User-facing display name set by the user or application'`,
  `ALTER TABLE default.users COMMENT COLUMN profile_image_url 'URL to the user profile/avatar image'`,
  `ALTER TABLE default.users COMMENT COLUMN primary_email 'User primary email address'`,
  `ALTER TABLE default.users COMMENT COLUMN primary_email_verified '1 if the primary email has been verified, 0 otherwise'`,
  `ALTER TABLE default.users COMMENT COLUMN signed_up_at 'When the user first signed up (UTC)'`,
  `ALTER TABLE default.users COMMENT COLUMN client_metadata 'Application-defined JSON metadata readable and writable from client SDKs'`,
  `ALTER TABLE default.users COMMENT COLUMN client_read_only_metadata 'Application-defined JSON metadata readable from client SDKs but only writable from server'`,
  `ALTER TABLE default.users COMMENT COLUMN server_metadata 'Application-defined JSON metadata only accessible from server SDKs'`,
  `ALTER TABLE default.users COMMENT COLUMN is_anonymous '1 if this is an anonymous/guest user, 0 for authenticated users'`,
  `ALTER TABLE default.users COMMENT COLUMN restricted_by_admin '1 if an admin has restricted this user access'`,
  `ALTER TABLE default.users COMMENT COLUMN restricted_by_admin_reason 'Admin-provided reason for restricting the user, shown to the user'`,
  `ALTER TABLE default.users COMMENT COLUMN restricted_by_admin_private_details 'Private admin notes about the restriction, not shown to the user'`,

  // ── contact_channels ──
  `ALTER TABLE default.contact_channels COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN id 'Unique contact channel identifier'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN user_id 'Owner user ID (join to users.id)'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN type 'Channel type, e.g. email'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN value 'Channel value, e.g. the email address'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN is_primary '1 if this is the user primary contact channel'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN is_verified '1 if ownership of this channel has been verified'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN used_for_auth '1 if this channel can be used as an authentication identifier'`,
  `ALTER TABLE default.contact_channels COMMENT COLUMN created_at 'When this contact channel was created (UTC)'`,

  // ── teams ──
  `ALTER TABLE default.teams COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.teams COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.teams COMMENT COLUMN id 'Unique team identifier'`,
  `ALTER TABLE default.teams COMMENT COLUMN display_name 'Team name shown in the UI'`,
  `ALTER TABLE default.teams COMMENT COLUMN profile_image_url 'URL to the team logo/avatar image'`,
  `ALTER TABLE default.teams COMMENT COLUMN created_at 'When the team was created (UTC)'`,
  `ALTER TABLE default.teams COMMENT COLUMN client_metadata 'Application-defined JSON metadata readable and writable from client SDKs'`,
  `ALTER TABLE default.teams COMMENT COLUMN client_read_only_metadata 'Application-defined JSON metadata readable from client SDKs but only writable from server'`,
  `ALTER TABLE default.teams COMMENT COLUMN server_metadata 'Application-defined JSON metadata only accessible from server SDKs'`,

  // ── team_member_profiles ──
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN team_id 'Team this membership belongs to (join to teams.id)'`,
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN user_id 'User in this membership (join to users.id)'`,
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN display_name 'Per-team display name override. NULL means use the user default display_name'`,
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN profile_image_url 'Per-team profile image override. NULL means use the user default'`,
  `ALTER TABLE default.team_member_profiles COMMENT COLUMN created_at 'When this team membership was created (UTC)'`,

  // ── team_permissions ──
  `ALTER TABLE default.team_permissions COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.team_permissions COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.team_permissions COMMENT COLUMN team_id 'Team this permission is scoped to (join to teams.id)'`,
  `ALTER TABLE default.team_permissions COMMENT COLUMN user_id 'User granted this permission (join to users.id)'`,
  `ALTER TABLE default.team_permissions COMMENT COLUMN id 'Permission identifier string, e.g. admin, member'`,
  `ALTER TABLE default.team_permissions COMMENT COLUMN created_at 'When this permission was granted (UTC)'`,

  // ── team_invitations ──
  `ALTER TABLE default.team_invitations COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN id 'Unique invitation identifier'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN team_id 'Team being invited to (join to teams.id)'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN team_display_name 'Snapshot of the team name at invitation time'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN recipient_email 'Email address the invitation was sent to'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN expires_at_millis 'Invitation expiry as Unix milliseconds. Compare with toUnixTimestamp64Milli(now())'`,
  `ALTER TABLE default.team_invitations COMMENT COLUMN created_at 'When the invitation was created (UTC)'`,

  // ── email_outboxes ──
  `ALTER TABLE default.email_outboxes COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN id 'Unique email record identifier'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN status 'Granular delivery status from the email provider'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN simple_status 'Simplified status for reporting, e.g. sent, delivered, failed'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN created_with 'How this email was created, e.g. programmatic API or draft editor'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN email_draft_id 'ID of the email draft template used, if created from a draft'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN email_programmatic_call_template_id 'ID of the programmatic template, if sent via API'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN theme_id 'Email theme/design ID applied to this email'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN is_high_priority '1 if marked as high priority for send ordering'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN is_transactional '1 for transactional emails (e.g. verification), NULL if unknown'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN subject 'Email subject line'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN notification_category_id 'Category for notification preferences/unsubscribe'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN started_rendering_at 'When email rendering began (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN rendered_at 'When email rendering completed (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN render_error 'Error message if rendering failed. Non-null implies render failure'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN scheduled_at 'When the email is/was scheduled to be sent (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN created_at 'When this email record was created (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN updated_at 'When this email record was last updated (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN started_sending_at 'When the send attempt began (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN server_error 'Error from the email provider. Non-null implies send failure'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN delivered_at 'When the email was confirmed delivered (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN opened_at 'When the recipient first opened the email (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN clicked_at 'When the recipient first clicked a link in the email (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN unsubscribed_at 'When the recipient unsubscribed via this email (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN marked_as_spam_at 'When the recipient marked this email as spam (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN bounced_at 'When the email bounced (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN delivery_delayed_at 'When a delivery delay was reported (UTC)'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN can_have_delivery_info '1 if the email provider supports delivery tracking for this email'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN skipped_reason 'Why sending was skipped, if applicable. Non-null implies send was skipped'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN skipped_details 'Additional details about why sending was skipped'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN send_retries 'Number of send retry attempts made'`,
  `ALTER TABLE default.email_outboxes COMMENT COLUMN is_paused '1 if email sending is currently paused'`,

  // ── project_permissions ──
  `ALTER TABLE default.project_permissions COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.project_permissions COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.project_permissions COMMENT COLUMN user_id 'User granted this permission (join to users.id)'`,
  `ALTER TABLE default.project_permissions COMMENT COLUMN id 'Permission identifier string'`,
  `ALTER TABLE default.project_permissions COMMENT COLUMN created_at 'When this permission was granted (UTC)'`,

  // ── notification_preferences ──
  `ALTER TABLE default.notification_preferences COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.notification_preferences COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.notification_preferences COMMENT COLUMN user_id 'User these preferences belong to (join to users.id)'`,
  `ALTER TABLE default.notification_preferences COMMENT COLUMN notification_category_id 'Notification category this preference applies to'`,
  `ALTER TABLE default.notification_preferences COMMENT COLUMN enabled '1 if the user has opted in to this notification category, 0 if opted out'`,

  // ── refresh_tokens ──
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN id 'Unique token identifier'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN user_id 'User this token belongs to (join to users.id)'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN created_at 'When the token was issued (UTC)'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN last_used_at 'When the token was last exchanged for an access token (UTC). Proxy for session activity'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN is_impersonation '1 if this is a dashboard/admin impersonation session'`,
  `ALTER TABLE default.refresh_tokens COMMENT COLUMN expires_at 'When the token expires (UTC). NULL means non-expiring'`,

  // ── connected_accounts ──
  `ALTER TABLE default.connected_accounts COMMENT COLUMN project_id 'Project identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.connected_accounts COMMENT COLUMN branch_id 'Branch identifier. Auto-filtered by row-level security — do not use in WHERE clauses'`,
  `ALTER TABLE default.connected_accounts COMMENT COLUMN user_id 'User this account is linked to (join to users.id)'`,
  `ALTER TABLE default.connected_accounts COMMENT COLUMN provider 'OAuth/SSO provider name, e.g. google, github'`,
  `ALTER TABLE default.connected_accounts COMMENT COLUMN provider_account_id 'User account ID at the external provider'`,
  `ALTER TABLE default.connected_accounts COMMENT COLUMN created_at 'When this account was linked (UTC)'`,
];

const COLUMN_COMMENT_TABLES = [
  "events",
  "spans",
  "users",
  "contact_channels",
  "teams",
  "team_member_profiles",
  "team_permissions",
  "team_invitations",
  "email_outboxes",
  "project_permissions",
  "notification_preferences",
  "refresh_tokens",
  "connected_accounts",
];

function buildColumnCommentSql(): string[] {
  const actionsByTable = new Map<string, string[]>();
  for (const table of COLUMN_COMMENT_TABLES) {
    actionsByTable.set(table, []);
  }

  for (const statement of COLUMN_COMMENT_STATEMENTS) {
    let matched = false;
    for (const table of COLUMN_COMMENT_TABLES) {
      const prefix = `ALTER TABLE default.${table} `;
      if (statement.startsWith(prefix)) {
        const actions = actionsByTable.get(table);
        if (actions == null) {
          throw new Error(`Missing column comment action group for analytics view: ${table}`);
        }
        actions.push(statement.slice(prefix.length));
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new Error(`Column comment statement does not target a known analytics view: ${statement}`);
    }
  }

  return COLUMN_COMMENT_TABLES.map((table) => {
    const actions = actionsByTable.get(table);
    if (actions == null || actions.length === 0) {
      throw new Error(`No column comments configured for analytics view: ${table}`);
    }
    return `ALTER TABLE default.${table}\n  ${actions.join(",\n  ")}`;
  });
}

const COLUMN_COMMENT_SQL = buildColumnCommentSql();

const EXTERNAL_ANALYTICS_DB_SQL = `
CREATE DATABASE IF NOT EXISTS analytics_internal;
`;

// Clickmap-only physical table (PostHog-style schema). Fed by clickmap_events_mv
// from analytics_internal.events WHERE event_type='$click'. Backwards compatible
// with click rows that pre-date elements_chain / scaled coords: the MV derives
// pointer_* from raw data.x / data.y / data.page_y, and elements_chain falls
// back to the empty string when the SDK didn't emit one.
//
// SCALE_FACTOR = 16 mirrors PostHog: pixel coords are divided at ingest so
// downstream queries operate on small integers and partitions stay compact.
//
// Order key (project_id, branch_id, date, path, viewport_width) matches the
// hot clickmap query: "all clicks on this path in this date range at these
// viewport widths".
//
// Dead-click classification lives on the click row itself: the SDK watches
// each click for up to ~3.75s for any observable effect and sets data.dead=1
// on the $click when there was none. One row per physical click, so count()
// stays the total and countIf(is_dead) is the dead subset; no second event
// type or table.
const CLICKMAP_EVENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS analytics_internal.clickmap_events (
    project_id           String,
    branch_id            String,
    event_at             DateTime64(3, 'UTC'),
    user_id              Nullable(String),
    session_replay_id    Nullable(String),
    url                  String,
    path                 String,
    viewport_width       UInt16,
    viewport_height      UInt16,
    pointer_x            UInt16,
    pointer_y            UInt16,
    client_y             UInt16,
    pointer_relative_x   Float32,
    pointer_target_fixed UInt8,
    elements_chain       String,
    selector             String,
    elements_text        String,
    tag_name             LowCardinality(String),
    href                 Nullable(String),
    is_dead              UInt8 DEFAULT 0
)
ENGINE MergeTree
PARTITION BY toYYYYMM(event_at)
ORDER BY (project_id, branch_id, toDate(event_at), path, viewport_width);
`;

const CLICKMAP_EVENTS_ADD_DEAD_COLUMN_SQL = `
ALTER TABLE analytics_internal.clickmap_events
ADD COLUMN IF NOT EXISTS is_dead UInt8 DEFAULT 0;
`;

// Materialized view that auto-populates clickmap_events on every $click insert.
// No POPULATE clause: existing rows stay in analytics_internal.events. New
// click rows flow into both tables.
//
// All field accesses use the toFloat64OrZero(toString(...)) pattern that the
// existing analytics queries use, so JSON-Variant nullability is handled the
// same way.
const CLICKMAP_EVENTS_MV_SQL = `
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_internal.clickmap_events_mv
TO analytics_internal.clickmap_events
AS
SELECT
    project_id,
    branch_id,
    event_at,
    user_id,
    session_replay_id,
    toString(data.url) AS url,
    toString(data.path) AS path,
    toUInt16(least(65535, greatest(0, toUInt32(toFloat64OrZero(toString(data.viewport_width)))))) AS viewport_width,
    toUInt16(least(65535, greatest(0, toUInt32(toFloat64OrZero(toString(data.viewport_height)))))) AS viewport_height,
    toUInt16(least(65535, greatest(0, toUInt32(
        coalesce(toFloat64OrNull(toString(data.x_scaled)), toFloat64OrZero(toString(data.page_x)) / 16, toFloat64OrZero(toString(data.x)) / 16)
    )))) AS pointer_x,
    toUInt16(least(65535, greatest(0, toUInt32(
        coalesce(toFloat64OrNull(toString(data.y_scaled)), toFloat64OrZero(toString(data.page_y)) / 16, toFloat64OrZero(toString(data.y)) / 16)
    )))) AS pointer_y,
    toUInt16(least(65535, greatest(0, toUInt32(
        coalesce(toFloat64OrNull(toString(data.client_y_scaled)), toFloat64OrZero(toString(data.y)) / 16)
    )))) AS client_y,
    toFloat32(coalesce(
        toFloat64OrNull(toString(data.pointer_relative_x)),
        if(toFloat64OrZero(toString(data.viewport_width)) > 0,
           toFloat64OrZero(toString(data.x)) / toFloat64OrZero(toString(data.viewport_width)),
           0)
    )) AS pointer_relative_x,
    toUInt8(coalesce(toUInt8OrNull(toString(data.pointer_target_fixed)), 0)) AS pointer_target_fixed,
    toString(data.elements_chain) AS elements_chain,
    toString(data.selector) AS selector,
    toString(data.text) AS elements_text,
    toString(data.tag_name) AS tag_name,
    nullIf(toString(data.href), '') AS href,
    toUInt8(coalesce(toUInt8OrNull(toString(data.dead)), 0)) AS is_dead
FROM analytics_internal.events
WHERE event_type = '$click';
`;
