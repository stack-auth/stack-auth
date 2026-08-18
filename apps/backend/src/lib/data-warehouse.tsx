// Core logic for the Data Warehouse app (`data-warehouse-alpha`): a per-project
// ClickHouse database plus a dedicated ClickHouse user with read/write access
// to it, living on the same ClickHouse instance that serves analytics.
//
// Why a per-project ClickHouse *user* and not just a database: ClickHouse row
// policies filter rows, they do not restrict which databases a query may name.
// The shared `limited_user` that `/analytics/query` connects as is one user for
// every project, so granting it access to one project's warehouse would let
// every other project read that warehouse by naming it explicitly. Isolation
// therefore has to come from the connecting user, which means one user per
// project, each granted only its own database.
//
// That user also carries the `analytics_reader` role (see
// scripts/clickhouse-migrations.ts), which holds the row policies and SELECT
// grants for the `default.*` analytics views. So a project with a warehouse
// keeps exactly the analytics access it had before, and can additionally join
// analytics data against its own tables. `SQL_project_id`/`SQL_branch_id` are
// pinned as CONST user-level settings rather than being passed per query,
// which is strictly stronger than the shared-user model: the row policies
// cannot be defeated by a caller that forgets to set them.
//
// ALPHA CAVEATS (deliberate, tracked):
// - TODO(data-warehouse-ga): add storage accounting and enforcement in a future
//   PR. We accept for alpha that ClickHouse has no native per-database size
//   limit, so a project can fill disk shared with our analytics.
// - TODO(data-warehouse-ga): add a deprovisioning/reconciliation path in a
//   future PR. We accept for alpha that deleting a tenancy cascades away the
//   PostgreSQL row while its ClickHouse database and still-usable user remain;
//   uninstalling the app likewise leaves both objects in place.
// - No downgrade enforcement yet. The entitlement gates provisioning and
//   rotation, but an already-provisioned ClickHouse user remains active after
//   the project loses the entitlement, including for direct connections. This
//   is an explicit alpha tradeoff: a future plan-change reconciler must disable
//   the ClickHouse user without deleting its database or customer data.
// - No plan-change reconciliation for ClickHouse settings. Per-user settings
//   (below) are a snapshot taken at provision/rotation time. Upgrading from
//   team to growth does not raise the ClickHouse-side defaults until the
//   password is rotated. The `/analytics/query` path is unaffected — it
//   computes the timeout per request from the live entitlement.
// - One database per project, not per branch. The database is named after the
//   project id, so a second branch in the same project would collide; the
//   Prisma model allows one row per tenancy and provisioning refuses when
//   another tenancy in the same project already owns the database.

import { getHexclaveServerApp } from "@/hexclave";
import { ANALYTICS_READER_ROLE, createClickhouseWarehouseClient, getClickhouseAdminClient } from "@/lib/clickhouse";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy, type PrismaClientTransaction } from "@/prisma-client";
import type { DataWarehouse } from "@/generated/prisma/client";
import { KnownErrors } from "@hexclave/shared";
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { ITEM_IDS, PLAN_LIMITS } from "@hexclave/shared/dist/plans";
import { yupObject, yupString, yupValidate } from "@hexclave/shared/dist/schema-fields";
import { generateSecureRandomString } from "@hexclave/shared/dist/utils/crypto";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { HexclaveAssertionError, StatusError, captureError } from "@hexclave/shared/dist/utils/errors";

/**
 * Hard ceiling on `max_execution_time` for a warehouse user, independent of the
 * project's plan. The plan's own timeout becomes the *default*; a direct
 * ClickHouse connection may raise it up to this value, which is the highest
 * timeout any plan grants.
 */
const MAX_EXECUTION_TIME_SECONDS = Math.max(...Object.values(PLAN_LIMITS).map(p => p.analyticsTimeoutSeconds));

/**
 * Per-query memory ceiling for warehouse users. Deliberately well below the
 * cluster's OvercommitTracker budget: these queries run on the same instance as
 * our own analytics, and (unlike `/analytics/query`, which we can shape per
 * request) a direct connection can run anything it likes.
 */
const MAX_MEMORY_USAGE_BYTES = 4_000_000_000;

/**
 * Aggregate memory ceiling across every query concurrently running as one
 * warehouse user. Keep this equal to the per-query ceiling: concurrency may
 * divide the budget, but can never multiply one customer's impact on the
 * shared analytics instance.
 */
const MAX_MEMORY_USAGE_FOR_USER_BYTES = MAX_MEMORY_USAGE_BYTES;

/** CPU/admission-control backstop for one customer's direct connections. */
const MAX_CONCURRENT_QUERIES_FOR_USER = 10;

/** Per-query CPU parallelism ceiling, so one query cannot occupy every core. */
const MAX_THREADS = 4;

/** Hourly quota per warehouse user. Generous — this is an abuse backstop, not a product limit. */
const QUOTA_INTERVAL_HOURS = 1;
const QUOTA_MAX_QUERIES = 10_000;
const QUOTA_MAX_ERRORS = 1_000;
const QUOTA_MAX_EXECUTION_TIME_SECONDS = 3_600;

/** PostgreSQL advisory-lock namespace for per-warehouse mutations. */
const DATA_WAREHOUSE_OPERATION_LOCK_CLASS = 247_911;
const DATA_WAREHOUSE_OPERATION_TIMEOUT_MS = 60_000;

const encryptedWarehousePasswordSchema = yupObject({
  edkBase64: yupString().defined(),
  ciphertextBase64: yupString().defined(),
}).defined();

/**
 * Table engines that can read from or write to somewhere other than this
 * ClickHouse instance. Recent ClickHouse versions already revoke these from
 * non-admin users by default (which is where `limited_user` gets its posture
 * from), but the warehouse user is the one account on the instance that can
 * create tables at all, so we revoke them explicitly rather than inheriting a
 * server default that a future config or version bump could change.
 *
 * Revoking a privilege that was never granted is a no-op in ClickHouse.
 */
const FORBIDDEN_TABLE_ENGINES = [
  "AzureBlobStorage", "Distributed", "File", "HDFS", "Hive", "JDBC", "Kafka",
  "MongoDB", "MySQL", "NATS", "ODBC", "PostgreSQL", "RabbitMQ", "Redis", "S3",
  "SQLite", "URL", "IcebergS3", "DeltaLake",
] as const;

/**
 * Local-only engines that remain useful in a customer warehouse. Once
 * table_engines_require_grant is enabled, ClickHouse requires an explicit
 * engine grant, so this allow-list is the counterpart to the deny-list above.
 */
const ALLOWED_TABLE_ENGINES = [
  "MergeTree", "ReplacingMergeTree", "SummingMergeTree", "AggregatingMergeTree",
  "CollapsingMergeTree", "VersionedCollapsingMergeTree", "GraphiteMergeTree",
  "Log", "TinyLog", "StripeLog", "Memory", "Set", "Join", "Buffer", "Null",
] as const;

/**
 * The matching *source* privileges, which gate the table functions (`url()`,
 * `s3()`, `remote()`, `file()`, …). Same reasoning as the engines above.
 *
 * Known gap (ClickHouse #99122): these REVOKEs gate the *execution* path, but
 * the schema-resolution path does not consult them. `DESCRIBE TABLE mysql(...)`
 * / `postgresql(...)` (and `CREATE TABLE AS ...`) connect to an
 * attacker-supplied host to infer the schema *before* the source check runs, so
 * revoking MYSQL/POSTGRES does not stop the outbound connection. `SELECT FROM
 * mysql(...)` is still blocked; only the DESCRIBE/CREATE-AS resolution leaks.
 * We verified this on ClickHouse Cloud (26.2.1.558): `url()`/`s3()`/`remote()`
 * are correctly denied even for DESCRIBE, but `mysql()`/`postgresql()` DESCRIBE
 * still dial out. The same bypass is reachable through `/analytics/query` as the
 * shared `limited_user`, independent of the Data Warehouse app.
 *
 * We accept this. The severe SSRF outcome — reading cloud instance-metadata
 * (IMDS) credentials — is not reachable through this bypass: the leaking
 * functions speak DB wire protocols and cannot emit the HTTP GET that IMDS
 * requires, and the functions that *can* speak HTTP (`url()`/`s3()`) are denied
 * even for DESCRIBE. So credential theft is blocked by the bypass's own protocol
 * limitation, not by anything we do; Cloud additionally appears to firewall
 * egress to IMDS/RFC1918. What remains is low, abuse-tier: a blind localhost
 * port scan of the ClickHouse node (open/closed distinguishable by error code +
 * timing) and blind outbound connects to public hosts — no rows, banners, or
 * credentials are readable, because the DB handshake needs valid target creds.
 * An app-layer statement guard would not help anyway: warehouse users hold
 * direct ClickHouse credentials and bypass our routes entirely. Self-hosted
 * operators who do not firewall IMDS should restrict ClickHouse egress
 * themselves; on Cloud we rely on the provider's network isolation.
 */
const FORBIDDEN_SOURCES = [
  "FILE", "URL", "REMOTE", "MYSQL", "ODBC", "JDBC", "HDFS", "S3", "HIVE",
  "MONGO", "REDIS", "SQLITE", "POSTGRES", "AZURE",
] as const;

/**
 * Privileges the warehouse user gets on its own database. Enough to use it as
 * a real warehouse — create and alter tables and views, insert, read, clean up
 * — and nothing outside that database. Dictionaries are deliberately omitted:
 * their HTTP and database-backed sources initiate server-side connections but
 * are not governed by the URL/S3/etc. source revokes below, which would turn
 * CREATE DICTIONARY into an SSRF primitive on the shared ClickHouse instance.
 */
const OWN_DATABASE_PRIVILEGES = [
  "SELECT", "INSERT", "ALTER", "CREATE TABLE", "CREATE VIEW",
  "DROP TABLE", "DROP VIEW", "TRUNCATE", "OPTIMIZE",
  "SHOW TABLES", "SHOW COLUMNS",
] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The single point where a project id becomes part of a ClickHouse identifier.
 * The ClickHouse client cannot parameterize identifiers, so every database and
 * user name is interpolated into DDL as a string — this assertion plus the
 * backtick quoting below is what makes that safe.
 *
 * Note that this rejects the `internal` project (whose id is not a UUID). That
 * is intentional: the internal project is Hexclave's own dashboard project and
 * has no business provisioning a customer warehouse.
 */
function quoteClickhouseIdentifierFromProjectId(projectId: string): string {
  if (!UUID_REGEX.test(projectId)) {
    throw new StatusError(400, "The Data Warehouse app is only available for regular projects.");
  }
  return `\`${projectId}\``;
}

export function getDataWarehouseNames(projectId: string): { databaseName: string, userName: string } {
  // Both the database and the user are named after the project id. They live in
  // different ClickHouse namespaces, so sharing the name is not a conflict, and
  // it makes an unexpected object on the instance trivially traceable.
  return { databaseName: projectId, userName: projectId };
}

export async function getDataWarehouse(tenancy: Tenancy): Promise<DataWarehouse | null> {
  const prisma = await getPrismaClientForTenancy(tenancy);
  return await prisma.dataWarehouse.findUnique({ where: { tenancyId: tenancy.id } });
}

/**
 * Throws unless the project's billing team is entitled to a Data Warehouse
 * (team plan or higher). Mirrors how `/analytics/query` gates the analytics
 * timeout, including the `STACK_DISABLE_PLAN_LIMITS` escape hatch.
 */
export async function ensureDataWarehouseEntitlement(tenancy: Tenancy): Promise<void> {
  if (!arePlanLimitsEnforced()) return;
  const billingTeamId = getBillingTeamId(tenancy.project);
  if (billingTeamId == null) return;
  const app = getHexclaveServerApp();
  const item = await app.getItem({ itemId: ITEM_IDS.dataWarehouse, teamId: billingTeamId });
  if (item.quantity < 1) {
    throw new KnownErrors.ItemQuantityInsufficientAmount(ITEM_IDS.dataWarehouse, billingTeamId, 1);
  }
}

/**
 * The project's analytics timeout entitlement, used as the ClickHouse-side
 * default for direct connections. Falls back to the platform maximum when plan
 * limits are disabled or the project has no billing team (self-hosted, and the
 * internal tenancy).
 */
async function getPlanTimeoutSeconds(tenancy: Tenancy): Promise<number> {
  const billingTeamId = getBillingTeamId(tenancy.project);
  if (billingTeamId == null || !arePlanLimitsEnforced()) return MAX_EXECUTION_TIME_SECONDS;
  const app = getHexclaveServerApp();
  const item = await app.getItem({ itemId: ITEM_IDS.analyticsTimeoutSeconds, teamId: billingTeamId });
  // A zero entitlement would mean "unlimited" to ClickHouse, so clamp to at
  // least one second. `/analytics/query` rejects those projects outright.
  return Math.min(Math.max(item.quantity, 1), MAX_EXECUTION_TIME_SECONDS);
}

async function assertClickhouseWarehouseSecurityPrerequisites(): Promise<void> {
  const probeSuffix = generateSecureRandomString(80);
  if (!/^[a-zA-Z0-9]+$/.test(probeSuffix)) {
    throw new HexclaveAssertionError("Unexpected random string shape for the ClickHouse engine-grant probe");
  }
  const probeName = `data_warehouse_engine_probe_${probeSuffix}`;
  const quotedProbe = `\`${probeName}\``;
  const probePassword = generateWarehousePassword();
  const adminClient = getClickhouseAdminClient();
  let operationFailed = false;
  try {
    // There used to be a minimum-version gate here, requiring an upstream build
    // that contained the loop() row-policy fix (#97682) and the remote
    // schema-inference access-check fix (#99122). It was removed because it
    // gated on upstream build numbers, which ClickHouse Cloud does not follow:
    // Cloud backports fixes without landing on the corresponding upstream patch
    // release. We reproduced the loop() row-policy bypass on a local
    // (unpatched) server, then ran the same probe against a real ClickHouse
    // Cloud service reporting 26.2.1.558 — below the gate's threshold, and the
    // exact version the gate's unit test asserted was unsafe — and the row
    // policy held: a user pinned to one project read zero foreign rows through
    // loop(), while a policy-free control user on the same data saw them. So the
    // gate would have refused to provision on Cloud services that are in fact
    // patched, blocking the product for no gain.
    //
    // The bugs are still reachable on unpatched local/self-hosted servers. We
    // accept that: warehouse credentials are a production concern, and local
    // development has no cross-tenant data worth protecting.
    await adminClient.command({
      query: `CREATE USER ${quotedProbe} IDENTIFIED WITH sha256_password BY {password:String}`,
      query_params: { password: probePassword },
    });
    await adminClient.command({ query: `GRANT CREATE TABLE ON default.* TO ${quotedProbe}` });

    const probeClient = createClickhouseWarehouseClient({ username: probeName, password: probePassword }, "default");
    try {
      await probeClient.command({
        query: `CREATE TABLE default.${quotedProbe} (value UInt8) ENGINE = Memory`,
      });
      throw new HexclaveAssertionError(
        "ClickHouse must enable access_control_improvements.table_engines_require_grant before provisioning Data Warehouse users",
      );
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("TABLE ENGINE ON Memory")) {
        throw error;
      }
    } finally {
      await probeClient.close();
    }
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    const cleanedUp = await runClickhouseCleanupSteps("data-warehouse-engine-grant-probe-cleanup", [
      async () => await adminClient.command({ query: `DROP TABLE IF EXISTS default.${quotedProbe}` }),
      async () => await adminClient.command({ query: `DROP USER IF EXISTS ${quotedProbe}` }),
      async () => await adminClient.close(),
    ]);
    if (!cleanedUp && !operationFailed) {
      throw new HexclaveAssertionError("Failed to clean up the ClickHouse engine-grant probe");
    }
  }
}

async function runClickhouseCleanupSteps(
  context: string,
  steps: ReadonlyArray<() => Promise<unknown>>,
  reportError: (context: string, error: unknown) => void = (errorContext, error) => captureError(errorContext, error),
): Promise<boolean> {
  let succeeded = true;
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      succeeded = false;
      reportError(context, error);
    }
  }
  return succeeded;
}

import.meta.vitest?.test("ClickHouse cleanup attempts every step after a failure", async ({ expect }) => {
  const attempts: string[] = [];
  const reportedErrors: unknown[] = [];
  const firstError = new Error("first cleanup failed");
  const succeeded = await runClickhouseCleanupSteps("test-cleanup", [
    async () => {
      attempts.push("first");
      throw firstError;
    },
    async () => {
      attempts.push("second");
    },
    async () => {
      attempts.push("close");
    },
  ], (_context, error) => reportedErrors.push(error));

  expect(succeeded).toBe(false);
  expect(attempts).toEqual(["first", "second", "close"]);
  expect(reportedErrors).toEqual([firstError]);
});

/**
 * Creates (or repairs) the ClickHouse database, user, grants, settings, and
 * quota for a project, and sets the user's password to `password`.
 *
 * Every statement is idempotent, so this doubles as the retry path for a
 * provisioning run that died halfway: re-running it converges on the same
 * state rather than failing on objects that already exist.
 */
async function applyWarehouseDdl(options: {
  tenancy: Tenancy,
  databaseName: string,
  userName: string,
  password: string,
}): Promise<void> {
  const { tenancy, databaseName, userName, password } = options;
  const quotedDatabase = quoteClickhouseIdentifierFromProjectId(databaseName);
  const quotedUser = quoteClickhouseIdentifierFromProjectId(userName);
  const quotaName = `\`${userName}_quota\``;
  const timeoutSeconds = await getPlanTimeoutSeconds(tenancy);
  const client = getClickhouseAdminClient();

  try {
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${quotedDatabase}` });

    // CREATE ... IF NOT EXISTS followed by ALTER, rather than CREATE OR REPLACE:
    // replacing a user drops its grants and detaches its quota, which would
    // silently strip a working warehouse of its access on every rotation.
    await client.command({
      query: `CREATE USER IF NOT EXISTS ${quotedUser} IDENTIFIED WITH sha256_password BY {password:String}`,
      query_params: { password },
    });
    // ClickHouse does not accept query parameters inside a SETTINGS clause, so
    // the two identity settings are interpolated as string literals. The
    // project id is UUID-validated above and the branch id is checked here —
    // between them, nothing that reaches this template can carry a quote.
    if (!/^[a-zA-Z0-9_-]+$/.test(tenancy.branchId)) {
      throw new HexclaveAssertionError("Unexpected branch id shape for a ClickHouse setting", { branchId: tenancy.branchId });
    }
    // Start from nothing so that a re-run also *removes* anything a previous
    // version of this function granted.
    await client.command({ query: `REVOKE ALL PRIVILEGES ON *.* FROM ${quotedUser}` });
    await client.command({ query: `REVOKE ALL FROM ${quotedUser}` });

    await client.command({ query: `GRANT ${ANALYTICS_READER_ROLE} TO ${quotedUser}` });
    await client.command({
      query: `GRANT ${OWN_DATABASE_PRIVILEGES.join(", ")} ON ${quotedDatabase}.* TO ${quotedUser}`,
    });
    // Needed for the database to be listable/usable by clients that introspect
    // before querying (clickhouse-client, BI tools, dbt).
    await client.command({ query: `GRANT SHOW DATABASES ON ${quotedDatabase}.* TO ${quotedUser}` });

    for (const engine of ALLOWED_TABLE_ENGINES) {
      await client.command({ query: `GRANT TABLE ENGINE ON ${engine} TO ${quotedUser}` });
    }
    for (const engine of FORBIDDEN_TABLE_ENGINES) {
      await client.command({ query: `REVOKE TABLE ENGINE ON ${engine} FROM ${quotedUser}` });
    }
    for (const source of FORBIDDEN_SOURCES) {
      await client.command({ query: `REVOKE ${source} ON *.* FROM ${quotedUser}` });
    }

    await client.command({
      query: `
        CREATE QUOTA OR REPLACE ${quotaName}
        KEYED BY user_name
        FOR INTERVAL ${QUOTA_INTERVAL_HOURS} HOUR
          MAX queries = ${QUOTA_MAX_QUERIES},
              errors = ${QUOTA_MAX_ERRORS},
              execution_time = ${QUOTA_MAX_EXECUTION_TIME_SECONDS}
        TO ${quotedUser}
      `,
    });

    // Change the password last. If any preceding grant or quota command fails,
    // a rotation can still repair the full prior DDL state using the old
    // password instead of locking the customer and backend out mid-operation.
    await client.command({
      query: `
        ALTER USER ${quotedUser}
        IDENTIFIED WITH sha256_password BY {password:String}
        DEFAULT ROLE ALL
        SETTINGS
          SQL_project_id = '${tenancy.project.id}' CONST,
          SQL_branch_id = '${tenancy.branchId}' CONST,
          max_execution_time = ${timeoutSeconds} MAX ${MAX_EXECUTION_TIME_SECONDS},
          max_memory_usage = ${MAX_MEMORY_USAGE_BYTES} MAX ${MAX_MEMORY_USAGE_BYTES},
          max_memory_usage_for_user = ${MAX_MEMORY_USAGE_FOR_USER_BYTES} MAX ${MAX_MEMORY_USAGE_FOR_USER_BYTES},
          max_concurrent_queries_for_user = ${MAX_CONCURRENT_QUERIES_FOR_USER} MAX ${MAX_CONCURRENT_QUERIES_FOR_USER},
          max_threads = ${MAX_THREADS} MAX ${MAX_THREADS}
      `,
      query_params: { password },
    });
  } finally {
    await client.close();
  }
}

async function decryptWarehousePassword(encryptedPassword: DataWarehouse["encryptedPassword"]): Promise<string | null> {
  if (encryptedPassword == null) return null;
  const envelope = await yupValidate(encryptedWarehousePasswordSchema, encryptedPassword);
  return await decryptWithKms(envelope);
}

async function withDataWarehouseOperationLock<T>(options: {
  prisma: Awaited<ReturnType<typeof getPrismaClientForTenancy>>,
  tenancyId: string,
  operation: (tx: PrismaClientTransaction) => Promise<T>,
}): Promise<T> {
  // This transaction deliberately spans the ClickHouse mutation. Retrying it
  // could replay a non-transactional external side effect, so this must not use
  // retryTransaction. The advisory lock makes overlapping provision/rotation
  // requests fail immediately instead of returning two competing passwords.
  //
  // TODO(data-warehouse-ga): replace this with a durable multi-phase operation
  // in a future PR. We accept for alpha that a PostgreSQL commit failure after
  // the callback returns is ambiguous: ClickHouse may have the new password
  // while PostgreSQL retains the old encrypted password. The in-callback
  // recovery below cannot observe or reconcile that commit-phase failure.
  // eslint-disable-next-line no-restricted-syntax
  return await options.prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(
        ${DATA_WAREHOUSE_OPERATION_LOCK_CLASS}::int,
        hashtext(${options.tenancyId}::text)
      ) AS locked
    `;
    if (lockRows.length !== 1) {
      throw new HexclaveAssertionError("PostgreSQL returned an unexpected result count for the Data Warehouse advisory lock", {
        resultCount: lockRows.length,
      });
    }
    const [lockRow] = lockRows;
    if (!lockRow.locked) {
      throw new StatusError(409, "Another Data Warehouse operation is already in progress. Please try again.");
    }
    return await options.operation(tx);
  }, { timeout: DATA_WAREHOUSE_OPERATION_TIMEOUT_MS });
}

async function restorePreviousWarehouseDdl(options: {
  tenancy: Tenancy,
  databaseName: string,
  userName: string,
  previousPassword: string,
}): Promise<boolean> {
  try {
    await applyWarehouseDdl({
      tenancy: options.tenancy,
      databaseName: options.databaseName,
      userName: options.userName,
      password: options.previousPassword,
    });
    return true;
  } catch (error) {
    captureError("data-warehouse-restore-previous-ddl", error);
    return false;
  }
}

async function cleanUpUnpersistedWarehouseUser(userName: string): Promise<boolean> {
  const quotedUser = quoteClickhouseIdentifierFromProjectId(userName);
  const quotaName = `\`${userName}_quota\``;
  const client = getClickhouseAdminClient();
  // Keep the database and any customer data so a retry remains non-destructive,
  // but remove credentials that the failed request could not return or store.
  // Every step is attempted even if an earlier one fails; in particular, a
  // quota cleanup failure must never leave live credentials behind by itself.
  return await runClickhouseCleanupSteps("data-warehouse-clean-up-unpersisted-user", [
    async () => await client.command({ query: `DROP QUOTA IF EXISTS ${quotaName}` }),
    async () => await client.command({ query: `DROP USER IF EXISTS ${quotedUser}` }),
    async () => await client.close(),
  ]);
}

async function recoverPreviousWarehouseAccess(options: {
  tenancy: Tenancy,
  databaseName: string,
  userName: string,
  previousPassword: string | null,
}): Promise<boolean> {
  return options.previousPassword == null
    ? await cleanUpUnpersistedWarehouseUser(options.userName)
    : await restorePreviousWarehouseDdl({
      tenancy: options.tenancy,
      databaseName: options.databaseName,
      userName: options.userName,
      previousPassword: options.previousPassword,
    });
}

function generateWarehousePassword(): string {
  // base32, so it survives every connection-string and CLI quoting context a
  // customer might paste it into.
  return generateSecureRandomString(160);
}

/**
 * Provisions the project's warehouse and returns the password *once* — it is
 * stored KMS-encrypted and never returned by any read path.
 *
 * Safe to call again after a failure: the DDL is idempotent and a FAILED row is
 * retried in place. Calling it on an already-READY warehouse is rejected, since
 * that would silently invalidate credentials the customer is already using
 * (rotation is the explicit way to do that).
 */
export async function provisionDataWarehouse(tenancy: Tenancy): Promise<{ password: string, warehouse: DataWarehouse }> {
  await ensureDataWarehouseEntitlement(tenancy);

  const prisma = await getPrismaClientForTenancy(tenancy);
  const { databaseName, userName } = getDataWarehouseNames(tenancy.project.id);

  type ProvisionResult =
    | { status: "ok", password: string, warehouse: DataWarehouse }
    | { status: "failed" };

  const result = await withDataWarehouseOperationLock({
    prisma,
    tenancyId: tenancy.id,
    operation: async (tx): Promise<ProvisionResult> => {
      const existing = await tx.dataWarehouse.findUnique({ where: { tenancyId: tenancy.id } });
      if (existing?.status === "READY") {
        throw new StatusError(400, "This project already has a data warehouse. Rotate the password instead if you need new credentials.");
      }
      const previousPassword = existing == null
        ? null
        : await decryptWarehousePassword(existing.encryptedPassword);
      // The ClickHouse database is per project while this row is per tenancy, so a
      // second tenancy in the same project would provision on top of the first
      // one's data. Branches don't exist yet, so this is a guard against a future
      // change rather than a reachable state today.
      const otherTenancyRow = await tx.dataWarehouse.findUnique({ where: { userName } });
      if (otherTenancyRow != null && otherTenancyRow.tenancyId !== tenancy.id) {
        throw new HexclaveAssertionError("A data warehouse for this project is already owned by another tenancy", {
          projectId: tenancy.project.id,
          tenancyId: tenancy.id,
          otherTenancyId: otherTenancyRow.tenancyId,
        });
      }
      await assertClickhouseWarehouseSecurityPrerequisites();

      await tx.dataWarehouse.upsert({
        where: { tenancyId: tenancy.id },
        create: { tenancyId: tenancy.id, databaseName, userName, status: "PROVISIONING" },
        update: { status: "PROVISIONING", error: null },
      });

      const password = generateWarehousePassword();
      const encryptedPassword = await encryptWithKms(password);
      try {
        await applyWarehouseDdl({ tenancy, databaseName, userName, password });
      } catch (error) {
        captureError("data-warehouse-provision-ddl", error);
        const recovered = await recoverPreviousWarehouseAccess({ tenancy, databaseName, userName, previousPassword });
        await tx.dataWarehouse.update({
          where: { tenancyId: tenancy.id },
          data: {
            status: "FAILED",
            error: recovered
              ? "Provisioning failed. Please try again."
              : "Provisioning failed and the partial credentials could not be cleaned up. Please try again.",
          },
        });
        return { status: "failed" };
      }

      try {
        const warehouse = await tx.dataWarehouse.update({
          where: { tenancyId: tenancy.id },
          data: {
            status: "READY",
            error: null,
            encryptedPassword,
            passwordUpdatedAt: new Date(),
          },
        });
        return { status: "ok", password, warehouse };
      } catch (error) {
        const recovered = await recoverPreviousWarehouseAccess({ tenancy, databaseName, userName, previousPassword });
        throw new HexclaveAssertionError(
          recovered
            ? "Failed to persist Data Warehouse credentials after ClickHouse provisioning; the previous access state was restored"
            : "Failed to persist Data Warehouse credentials after ClickHouse provisioning and could not restore the previous access state",
          { cause: error, tenancyId: tenancy.id },
        );
      }
    },
  });

  if (result.status === "failed") {
    throw new StatusError(500, "Failed to provision the data warehouse. Please try again.");
  }
  return { password: result.password, warehouse: result.warehouse };
}

/**
 * Issues a new password for an existing warehouse and returns it once.
 * Re-applies the full DDL on the way, so a warehouse whose grants drifted (or
 * whose provisioning half-failed) is repaired by rotating.
 */
export async function rotateDataWarehousePassword(tenancy: Tenancy): Promise<{ password: string, warehouse: DataWarehouse }> {
  await ensureDataWarehouseEntitlement(tenancy);

  const prisma = await getPrismaClientForTenancy(tenancy);

  type RotationResult =
    | { status: "ok", password: string, warehouse: DataWarehouse }
    | { status: "failed" };

  const result = await withDataWarehouseOperationLock({
    prisma,
    tenancyId: tenancy.id,
    operation: async (tx): Promise<RotationResult> => {
      const existing = await tx.dataWarehouse.findUnique({ where: { tenancyId: tenancy.id } });
      if (existing == null) {
        throw new StatusError(400, "This project does not have a data warehouse yet.");
      }
      const previousPassword = await decryptWarehousePassword(existing.encryptedPassword);
      if (previousPassword == null) {
        throw new HexclaveAssertionError("A provisioned Data Warehouse must have an encrypted password before it can be rotated", {
          tenancyId: tenancy.id,
          warehouseStatus: existing.status,
        });
      }
      await assertClickhouseWarehouseSecurityPrerequisites();

      const password = generateWarehousePassword();
      const encryptedPassword = await encryptWithKms(password);
      try {
        await applyWarehouseDdl({
          tenancy,
          databaseName: existing.databaseName,
          userName: existing.userName,
          password,
        });
      } catch (error) {
        captureError("data-warehouse-rotate-ddl", error);
        const restored = await restorePreviousWarehouseDdl({
          tenancy,
          databaseName: existing.databaseName,
          userName: existing.userName,
          previousPassword,
        });
        if (!restored) {
          await tx.dataWarehouse.update({
            where: { tenancyId: tenancy.id },
            data: {
              status: "FAILED",
              error: "Password rotation failed and the previous credentials could not be restored. Please try again.",
            },
          });
        }
        return { status: "failed" };
      }

      try {
        const warehouse = await tx.dataWarehouse.update({
          where: { tenancyId: tenancy.id },
          data: {
            status: "READY",
            error: null,
            encryptedPassword,
            passwordUpdatedAt: new Date(),
          },
        });
        return { status: "ok", password, warehouse };
      } catch (error) {
        const restored = await restorePreviousWarehouseDdl({
          tenancy,
          databaseName: existing.databaseName,
          userName: existing.userName,
          previousPassword,
        });
        throw new HexclaveAssertionError(
          restored
            ? "Failed to persist the rotated Data Warehouse password; the previous password was restored"
            : "Failed to persist the rotated Data Warehouse password and could not restore the previous password",
          { cause: error, tenancyId: tenancy.id },
        );
      }
    },
  });

  if (result.status === "failed") {
    throw new StatusError(500, "Failed to rotate the data warehouse password. Please try again.");
  }
  return { password: result.password, warehouse: result.warehouse };
}

/**
 * The ClickHouse credentials `/analytics/query` should connect with, or `null`
 * when the project has no usable warehouse (in which case the caller falls back
 * to the shared `limited_user`).
 *
 * Decrypts on every call. That is a deliberate choice for the alpha: caching
 * decrypted passwords in process memory is the kind of thing that needs an
 * invalidation story across instances, and rotation is a user-visible action.
 */
export async function getDataWarehouseQueryAuth(tenancy: Tenancy): Promise<{ username: string, password: string } | null> {
  const warehouse = await getDataWarehouse(tenancy);
  if (warehouse == null || warehouse.status !== "READY" || warehouse.encryptedPassword == null) {
    return null;
  }
  const password = await decryptWarehousePassword(warehouse.encryptedPassword);
  if (password == null) {
    throw new HexclaveAssertionError("A READY Data Warehouse must have an encrypted password", { tenancyId: tenancy.id });
  }
  return { username: warehouse.userName, password };
}

/**
 * Host and ports a customer points their own ClickHouse client at. Falls back
 * to the host of the backend's own ClickHouse URL, which is right for local
 * development and wrong for any deployment where the instance is reachable
 * under a different name — hence the explicit env var.
 */
export function getDataWarehouseConnectionInfo(): { host: string, httpsPort: number, nativePort: number } {
  const configuredHost = getEnvVariable("HEXCLAVE_CLICKHOUSE_PUBLIC_HOST", "");
  const host = configuredHost || new URL(getEnvVariable("HEXCLAVE_CLICKHOUSE_URL")).hostname;
  const httpsPort = Number(getEnvVariable("HEXCLAVE_CLICKHOUSE_PUBLIC_HTTPS_PORT", "8443"));
  const nativePort = Number(getEnvVariable("HEXCLAVE_CLICKHOUSE_PUBLIC_NATIVE_PORT", "9440"));
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new HexclaveAssertionError("HEXCLAVE_CLICKHOUSE_PUBLIC_HTTPS_PORT must be an integer between 1 and 65535", { httpsPort });
  }
  if (!Number.isInteger(nativePort) || nativePort < 1 || nativePort > 65_535) {
    throw new HexclaveAssertionError("HEXCLAVE_CLICKHOUSE_PUBLIC_NATIVE_PORT must be an integer between 1 and 65535", { nativePort });
  }
  return {
    host,
    httpsPort,
    nativePort,
  };
}
