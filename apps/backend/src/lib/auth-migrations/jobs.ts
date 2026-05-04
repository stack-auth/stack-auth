import { Prisma } from "@/generated/prisma/client";
import { getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { globalPrismaClient } from "@/prisma-client";
import { StackAssertionError, StatusError, errorToNiceString } from "@stackframe/stack-shared/dist/utils/errors";
import { decryptMigrationCredentials, encryptMigrationCredentials } from "./crypto";
import { importPlanToStackAuth } from "./stack-import";
import { prepareAuthMigration } from "./providers";
import type { AuthMigrationCredentials, AuthMigrationJobRow, AuthMigrationProvider, AuthMigrationStatus, EncryptedMigrationCredentials, JsonObject } from "./types";

const MAX_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 20_000;
const STUCK_RUNNING_TIMEOUT_MS = 20 * 60 * 1000;

type ClaimedAuthMigrationJobRow = AuthMigrationJobRow & {
  encrypted_credentials: EncryptedMigrationCredentials,
};

export type AuthMigrationJobApi = {
  id: string,
  provider: AuthMigrationProvider,
  status: AuthMigrationStatus,
  attempt_count: number,
  max_attempts: number,
  next_attempt_at_millis: number | null,
  started_at_millis: number | null,
  finished_at_millis: number | null,
  last_error_external_message: string | null,
  result: unknown,
  created_at_millis: number,
  updated_at_millis: number,
};

function rowToApi(row: AuthMigrationJobRow): AuthMigrationJobApi {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    next_attempt_at_millis: row.next_attempt_at?.getTime() ?? null,
    started_at_millis: row.started_at?.getTime() ?? null,
    finished_at_millis: row.finished_at?.getTime() ?? null,
    last_error_external_message: row.last_error_external_message,
    result: row.result,
    created_at_millis: row.created_at.getTime(),
    updated_at_millis: row.updated_at.getTime(),
  };
}

function selectJobSql(whereSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      "id",
      "tenancyId" AS "tenancy_id",
      "projectId" AS "project_id",
      "branchId" AS "branch_id",
      "provider",
      "status",
      "createdByProjectUserId" AS "created_by_project_user_id",
      "attemptCount" AS "attempt_count",
      "maxAttempts" AS "max_attempts",
      "nextAttemptAt" AS "next_attempt_at",
      "startedAt" AS "started_at",
      "finishedAt" AS "finished_at",
      "lastErrorExternalMessage" AS "last_error_external_message",
      "lastErrorInternalDetails" AS "last_error_internal_details",
      "result",
      "createdAt" AS "created_at",
      "updatedAt" AS "updated_at"
    FROM "AuthDataMigrationJob"
    ${whereSql}
  `;
}

function selectClaimedJobSql(whereSql: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      "id",
      "tenancyId" AS "tenancy_id",
      "projectId" AS "project_id",
      "branchId" AS "branch_id",
      "provider",
      "status",
      "createdByProjectUserId" AS "created_by_project_user_id",
      "attemptCount" AS "attempt_count",
      "maxAttempts" AS "max_attempts",
      "nextAttemptAt" AS "next_attempt_at",
      "startedAt" AS "started_at",
      "finishedAt" AS "finished_at",
      "lastErrorExternalMessage" AS "last_error_external_message",
      "lastErrorInternalDetails" AS "last_error_internal_details",
      "encryptedCredentials" AS "encrypted_credentials",
      "result",
      "createdAt" AS "created_at",
      "updatedAt" AS "updated_at"
    FROM "AuthDataMigrationJob"
    ${whereSql}
  `;
}

function calculateRetryDelay(attemptCount: number): number {
  return (Math.random() + 0.5) * BASE_RETRY_DELAY_MS * Math.pow(2, attemptCount - 1);
}

export async function createAuthMigrationJob(options: {
  tenancyId: string,
  projectId: string,
  branchId: string,
  provider: AuthMigrationProvider,
  credentials: AuthMigrationCredentials,
  createdByProjectUserId: string | null,
}): Promise<AuthMigrationJobApi> {
  const encryptedCredentials = await encryptMigrationCredentials(options.credentials);
  const rows = await globalPrismaClient.$queryRaw<AuthMigrationJobRow[]>`
    INSERT INTO "AuthDataMigrationJob" (
      "tenancyId",
      "projectId",
      "branchId",
      "provider",
      "encryptedCredentials",
      "createdByProjectUserId",
      "maxAttempts",
      "nextAttemptAt"
    )
    VALUES (
      ${options.tenancyId}::uuid,
      ${options.projectId},
      ${options.branchId},
      ${options.provider},
      ${JSON.stringify(encryptedCredentials)}::jsonb,
      ${options.createdByProjectUserId}::uuid,
      ${MAX_ATTEMPTS},
      NOW()
    )
    RETURNING
      "id",
      "tenancyId" AS "tenancy_id",
      "projectId" AS "project_id",
      "branchId" AS "branch_id",
      "provider",
      "status",
      "createdByProjectUserId" AS "created_by_project_user_id",
      "attemptCount" AS "attempt_count",
      "maxAttempts" AS "max_attempts",
      "nextAttemptAt" AS "next_attempt_at",
      "startedAt" AS "started_at",
      "finishedAt" AS "finished_at",
      "lastErrorExternalMessage" AS "last_error_external_message",
      "lastErrorInternalDetails" AS "last_error_internal_details",
      "result",
      "createdAt" AS "created_at",
      "updatedAt" AS "updated_at"
  `;
  if (rows.length !== 1) throw new StackAssertionError("Auth migration job insert returned no rows");
  return rowToApi(rows[0]);
}

export async function listAuthMigrationJobs(tenancyId: string): Promise<AuthMigrationJobApi[]> {
  const rows = await globalPrismaClient.$queryRaw<AuthMigrationJobRow[]>(selectJobSql(Prisma.sql`
    WHERE "tenancyId" = ${tenancyId}::uuid
    ORDER BY "createdAt" DESC, "id" DESC
  `));
  return rows.map(rowToApi);
}

export async function getAuthMigrationJob(tenancyId: string, id: string): Promise<AuthMigrationJobApi> {
  const rows = await globalPrismaClient.$queryRaw<AuthMigrationJobRow[]>(selectJobSql(Prisma.sql`
    WHERE "tenancyId" = ${tenancyId}::uuid AND "id" = ${id}::uuid
  `));
  if (rows.length !== 1) throw new StatusError(404, "Auth migration job not found");
  return rowToApi(rows[0]);
}

export async function retryAuthMigrationJob(tenancyId: string, id: string): Promise<AuthMigrationJobApi> {
  const rows = await globalPrismaClient.$queryRaw<AuthMigrationJobRow[]>`
    UPDATE "AuthDataMigrationJob"
    SET
      "status" = 'PENDING',
      "nextAttemptAt" = NOW(),
      "finishedAt" = NULL,
      "lastErrorExternalMessage" = NULL,
      "lastErrorInternalDetails" = NULL,
      "updatedAt" = NOW()
    WHERE "tenancyId" = ${tenancyId}::uuid
      AND "id" = ${id}::uuid
      AND "status" IN ('FAILED', 'WAITING_RETRY')
    RETURNING
      "id",
      "tenancyId" AS "tenancy_id",
      "projectId" AS "project_id",
      "branchId" AS "branch_id",
      "provider",
      "status",
      "createdByProjectUserId" AS "created_by_project_user_id",
      "attemptCount" AS "attempt_count",
      "maxAttempts" AS "max_attempts",
      "nextAttemptAt" AS "next_attempt_at",
      "startedAt" AS "started_at",
      "finishedAt" AS "finished_at",
      "lastErrorExternalMessage" AS "last_error_external_message",
      "lastErrorInternalDetails" AS "last_error_internal_details",
      "result",
      "createdAt" AS "created_at",
      "updatedAt" AS "updated_at"
  `;
  if (rows.length !== 1) throw new StatusError(400, "Auth migration job is not retryable");
  return rowToApi(rows[0]);
}

async function resetStuckRunningJobs(): Promise<number> {
  const rows = await globalPrismaClient.$queryRaw<{ id: string }[]>`
    UPDATE "AuthDataMigrationJob"
    SET
      "status" = 'WAITING_RETRY',
      "nextAttemptAt" = NOW(),
      "lastErrorExternalMessage" = 'Migration worker timed out before finishing.',
      "lastErrorInternalDetails" = ${JSON.stringify({ type: "stuck-running-reset", timeoutMs: STUCK_RUNNING_TIMEOUT_MS })}::jsonb,
      "updatedAt" = NOW()
    WHERE "status" = 'RUNNING'
      AND "startedAt" <= NOW() - (${STUCK_RUNNING_TIMEOUT_MS} || ' milliseconds')::interval
    RETURNING "id"
  `;
  return rows.length;
}

async function claimDueJobs(limit: number): Promise<ClaimedAuthMigrationJobRow[]> {
  return await globalPrismaClient.$queryRaw<ClaimedAuthMigrationJobRow[]>`
    WITH picked AS (
      SELECT "tenancyId", "id"
      FROM "AuthDataMigrationJob"
      WHERE "status" IN ('PENDING', 'WAITING_RETRY')
        AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
      ORDER BY "nextAttemptAt" ASC NULLS FIRST, "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "AuthDataMigrationJob" AS job
    SET
      "status" = 'RUNNING',
      "startedAt" = NOW(),
      "finishedAt" = NULL,
      "attemptCount" = job."attemptCount" + 1,
      "updatedAt" = NOW()
    FROM picked
    WHERE job."tenancyId" = picked."tenancyId" AND job."id" = picked."id"
    RETURNING
      job."id",
      job."tenancyId" AS "tenancy_id",
      job."projectId" AS "project_id",
      job."branchId" AS "branch_id",
      job."provider",
      job."status",
      job."createdByProjectUserId" AS "created_by_project_user_id",
      job."attemptCount" AS "attempt_count",
      job."maxAttempts" AS "max_attempts",
      job."nextAttemptAt" AS "next_attempt_at",
      job."startedAt" AS "started_at",
      job."finishedAt" AS "finished_at",
      job."lastErrorExternalMessage" AS "last_error_external_message",
      job."lastErrorInternalDetails" AS "last_error_internal_details",
      job."encryptedCredentials" AS "encrypted_credentials",
      job."result",
      job."createdAt" AS "created_at",
      job."updatedAt" AS "updated_at"
  `;
}

async function markJobSucceeded(job: ClaimedAuthMigrationJobRow, result: JsonObject): Promise<void> {
  await globalPrismaClient.$executeRaw`
    UPDATE "AuthDataMigrationJob"
    SET
      "status" = 'SUCCEEDED',
      "finishedAt" = NOW(),
      "nextAttemptAt" = NULL,
      "result" = ${JSON.stringify(result)}::jsonb,
      "lastErrorExternalMessage" = NULL,
      "lastErrorInternalDetails" = NULL,
      "updatedAt" = NOW()
    WHERE "tenancyId" = ${job.tenancy_id}::uuid AND "id" = ${job.id}::uuid
  `;
}

async function markJobFailed(job: ClaimedAuthMigrationJobRow, error: unknown): Promise<void> {
  const willRetry = job.attempt_count < job.max_attempts;
  const nextAttemptAt = new Date(Date.now() + calculateRetryDelay(job.attempt_count));
  const internalDetails = {
    type: "auth-migration-job-error",
    attemptCount: job.attempt_count,
    provider: job.provider,
    error: errorToNiceString(error),
  };
  await globalPrismaClient.$executeRaw`
    UPDATE "AuthDataMigrationJob"
    SET
      "status" = ${willRetry ? "WAITING_RETRY" : "FAILED"},
      "finishedAt" = ${willRetry ? null : new Date()},
      "nextAttemptAt" = ${willRetry ? nextAttemptAt : null},
      "lastErrorExternalMessage" = ${error instanceof StatusError ? error.message : "Auth migration failed. Please check the migration details or try again."},
      "lastErrorInternalDetails" = ${JSON.stringify(internalDetails)}::jsonb,
      "updatedAt" = NOW()
    WHERE "tenancyId" = ${job.tenancy_id}::uuid AND "id" = ${job.id}::uuid
  `;
}

async function processJob(job: ClaimedAuthMigrationJobRow): Promise<void> {
  const credentials = await decryptMigrationCredentials(job.encrypted_credentials);
  const prepared = await prepareAuthMigration(job.provider, credentials);
  const tenancy = await getSoleTenancyFromProjectBranch(job.project_id, job.branch_id);
  const importResult = await importPlanToStackAuth(tenancy, prepared.plan);
  await markJobSucceeded(job, {
    ...importResult,
    provider: job.provider,
  });
}

export async function runAuthMigrationQueueStep(limit = 5): Promise<{ claimed: number, resetStuck: number }> {
  const resetStuck = await resetStuckRunningJobs();
  const jobs = await claimDueJobs(limit);
  for (const job of jobs) {
    try {
      await processJob(job);
    } catch (error) {
      await markJobFailed(job, error);
    }
  }
  return {
    claimed: jobs.length,
    resetStuck,
  };
}

export const _authMigrationJobsForTesting = {
  calculateRetryDelay,
};
