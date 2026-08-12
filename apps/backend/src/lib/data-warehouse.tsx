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
// - No storage quota. ClickHouse has no native per-database size limit, so
//   nothing stops a project from filling the disk shared with our analytics.
// - No deprovisioning. Uninstalling the app leaves the database and user in
//   place; there is no delete path yet.
// - No plan-change reconciliation. Per-user settings (below) are a snapshot
//   taken at provision/rotation time. Upgrading from team to growth does not
//   raise the ClickHouse-side defaults until the password is rotated. The
//   `/analytics/query` path is unaffected — it computes the timeout per
//   request from the live entitlement.
// - One database per project, not per branch. The database is named after the
//   project id, so a second branch in the same project would collide; the
//   Prisma model allows one row per tenancy and provisioning refuses when
//   another tenancy in the same project already owns the database.

import { getHexclaveServerApp } from "@/hexclave";
import { ANALYTICS_READER_ROLE, getClickhouseAdminClient } from "@/lib/clickhouse";
import { arePlanLimitsEnforced, getBillingTeamId } from "@/lib/plan-entitlements";
import type { Tenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import type { DataWarehouse } from "@/generated/prisma/client";
import { KnownErrors } from "@hexclave/shared";
import { decryptWithKms, encryptWithKms } from "@hexclave/shared/dist/helpers/vault/server-side";
import { ITEM_IDS, PLAN_LIMITS } from "@hexclave/shared/dist/plans";
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

/** Hourly quota per warehouse user. Generous — this is an abuse backstop, not a product limit. */
const QUOTA_INTERVAL_HOURS = 1;
const QUOTA_MAX_QUERIES = 10_000;
const QUOTA_MAX_ERRORS = 1_000;
const QUOTA_MAX_EXECUTION_TIME_SECONDS = 3_600;

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
 * The matching *source* privileges, which gate the table functions (`url()`,
 * `s3()`, `remote()`, `file()`, …). Same reasoning as the engines above.
 */
const FORBIDDEN_SOURCES = [
  "FILE", "URL", "REMOTE", "MYSQL", "ODBC", "JDBC", "HDFS", "S3", "HIVE",
  "MONGO", "REDIS", "SQLITE", "POSTGRES", "AZURE",
] as const;

/**
 * Privileges the warehouse user gets on its own database. Enough to use it as
 * a real warehouse — create and alter tables and views, insert, read, clean up
 * — and nothing outside that database.
 */
const OWN_DATABASE_PRIVILEGES = [
  "SELECT", "INSERT", "ALTER", "CREATE TABLE", "CREATE VIEW", "CREATE DICTIONARY",
  "DROP TABLE", "DROP VIEW", "DROP DICTIONARY", "TRUNCATE", "OPTIMIZE",
  "SHOW TABLES", "SHOW COLUMNS", "SHOW DICTIONARIES", "dictGet",
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
    await client.command({
      query: `
        ALTER USER ${quotedUser}
        IDENTIFIED WITH sha256_password BY {password:String}
        DEFAULT ROLE ALL
        SETTINGS
          SQL_project_id = '${tenancy.project.id}' CONST,
          SQL_branch_id = '${tenancy.branchId}' CONST,
          max_execution_time = ${timeoutSeconds} MAX ${MAX_EXECUTION_TIME_SECONDS},
          max_memory_usage = ${MAX_MEMORY_USAGE_BYTES} MAX ${MAX_MEMORY_USAGE_BYTES}
      `,
      query_params: { password },
    });

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
  } finally {
    await client.close();
  }
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

  const existing = await prisma.dataWarehouse.findUnique({ where: { tenancyId: tenancy.id } });
  if (existing?.status === "READY") {
    throw new StatusError(400, "This project already has a data warehouse. Rotate the password instead if you need new credentials.");
  }
  // The ClickHouse database is per project while this row is per tenancy, so a
  // second tenancy in the same project would provision on top of the first
  // one's data. Branches don't exist yet, so this is a guard against a future
  // change rather than a reachable state today.
  const otherTenancyRow = await prisma.dataWarehouse.findUnique({ where: { userName } });
  if (otherTenancyRow != null && otherTenancyRow.tenancyId !== tenancy.id) {
    throw new HexclaveAssertionError("A data warehouse for this project is already owned by another tenancy", {
      projectId: tenancy.project.id,
      tenancyId: tenancy.id,
      otherTenancyId: otherTenancyRow.tenancyId,
    });
  }

  await prisma.dataWarehouse.upsert({
    where: { tenancyId: tenancy.id },
    create: { tenancyId: tenancy.id, databaseName, userName, status: "PROVISIONING" },
    update: { status: "PROVISIONING", error: null },
  });

  const password = generateWarehousePassword();
  try {
    await applyWarehouseDdl({ tenancy, databaseName, userName, password });
  } catch (error) {
    captureError("data-warehouse-provision", error);
    await prisma.dataWarehouse.update({
      where: { tenancyId: tenancy.id },
      data: { status: "FAILED", error: "Provisioning failed. Please try again." },
    });
    throw new StatusError(500, "Failed to provision the data warehouse. Please try again.");
  }

  // ClickHouse first, then the stored copy: if this write fails the customer's
  // displayed password still works, and the backend falls back to
  // `limited_user` for analytics until the next rotation repairs the row.
  const warehouse = await prisma.dataWarehouse.update({
    where: { tenancyId: tenancy.id },
    data: {
      status: "READY",
      error: null,
      encryptedPassword: await encryptWithKms(password),
      passwordUpdatedAt: new Date(),
    },
  });

  return { password, warehouse };
}

/**
 * Issues a new password for an existing warehouse and returns it once.
 * Re-applies the full DDL on the way, so a warehouse whose grants drifted (or
 * whose provisioning half-failed) is repaired by rotating.
 */
export async function rotateDataWarehousePassword(tenancy: Tenancy): Promise<{ password: string, warehouse: DataWarehouse }> {
  await ensureDataWarehouseEntitlement(tenancy);

  const prisma = await getPrismaClientForTenancy(tenancy);
  const existing = await prisma.dataWarehouse.findUnique({ where: { tenancyId: tenancy.id } });
  if (existing == null) {
    throw new StatusError(400, "This project does not have a data warehouse yet.");
  }

  const password = generateWarehousePassword();
  try {
    await applyWarehouseDdl({
      tenancy,
      databaseName: existing.databaseName,
      userName: existing.userName,
      password,
    });
  } catch (error) {
    captureError("data-warehouse-rotate", error);
    throw new StatusError(500, "Failed to rotate the data warehouse password. Please try again.");
  }

  const warehouse = await prisma.dataWarehouse.update({
    where: { tenancyId: tenancy.id },
    data: {
      status: "READY",
      error: null,
      encryptedPassword: await encryptWithKms(password),
      passwordUpdatedAt: new Date(),
    },
  });

  return { password, warehouse };
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
  const password = await decryptWithKms(warehouse.encryptedPassword as { edkBase64: string, ciphertextBase64: string });
  return { username: warehouse.userName, password };
}

/**
 * Host and ports a customer points their own ClickHouse client at. Falls back
 * to the host of the backend's own ClickHouse URL, which is right for local
 * development and wrong for any deployment where the instance is reachable
 * under a different name — hence the explicit env var.
 */
export function getDataWarehouseConnectionInfo(): { host: string, httpsPort: number, nativePort: number } {
  const configuredHost = getEnvVariable("STACK_CLICKHOUSE_PUBLIC_HOST", "");
  const host = configuredHost || new URL(getEnvVariable("STACK_CLICKHOUSE_URL")).hostname;
  return {
    host,
    httpsPort: Number(getEnvVariable("STACK_CLICKHOUSE_PUBLIC_HTTPS_PORT", "8443")),
    nativePort: Number(getEnvVariable("STACK_CLICKHOUSE_PUBLIC_NATIVE_PORT", "9440")),
  };
}
