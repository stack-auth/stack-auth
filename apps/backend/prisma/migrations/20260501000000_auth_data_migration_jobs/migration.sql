CREATE TABLE "AuthDataMigrationJob" (
  "tenancyId" UUID NOT NULL,
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "encryptedCredentials" JSONB NOT NULL,
  "createdByProjectUserId" UUID,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "lastErrorExternalMessage" TEXT,
  "lastErrorInternalDetails" JSONB,
  "result" JSONB,

  CONSTRAINT "AuthDataMigrationJob_pkey" PRIMARY KEY ("tenancyId", "id"),
  CONSTRAINT "AuthDataMigrationJob_tenancyId_fkey" FOREIGN KEY ("tenancyId") REFERENCES "Tenancy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuthDataMigrationJob_provider_valid" CHECK ("provider" IN ('workos', 'clerk', 'authjs', 'auth0', 'supabase', 'better_auth')),
  CONSTRAINT "AuthDataMigrationJob_status_valid" CHECK ("status" IN ('PENDING', 'RUNNING', 'WAITING_RETRY', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "AuthDataMigrationJob_attempts_valid" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0),
  CONSTRAINT "AuthDataMigrationJob_terminal_finished" CHECK (
    ("status" IN ('SUCCEEDED', 'FAILED') AND "finishedAt" IS NOT NULL)
    OR ("status" NOT IN ('SUCCEEDED', 'FAILED'))
  )
);

CREATE INDEX "AuthDataMigrationJob_queue_idx" ON "AuthDataMigrationJob"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "AuthDataMigrationJob_tenancy_created_idx" ON "AuthDataMigrationJob"("tenancyId", "createdAt");
