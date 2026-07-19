import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

export const preMigration = async (sql: Sql) => {
  const projectId = `test-project-${randomUUID()}`;
  await sql`INSERT INTO "Project" ("id", "displayName", "isProductionMode", "updatedAt") VALUES (${projectId}, 'Experiment defaults test', false, NOW())`;
  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const { projectId } = ctx;

  // Minimal insert exercises the defaults: state DRAFT, revisionNumber 1, createdAt now.
  const runId = randomUUID();
  await sql`
    INSERT INTO "ExperimentRun" ("id", "projectId", "branchId", "experimentId", "configRevisionHash", "configSnapshot", "updatedAt")
    VALUES (${runId}::uuid, ${projectId}, 'main', 'exp-1', 'hash-1', '{"flagId":"f"}'::jsonb, NOW())
  `;
  const runs = await sql`SELECT "state", "revisionNumber", "createdAt", "scheduledStartAt", "startedAt", "createdByUserId" FROM "ExperimentRun" WHERE "id" = ${runId}::uuid`;
  expect(runs).toHaveLength(1);
  expect(runs[0].state).toBe('DRAFT');
  expect(Number(runs[0].revisionNumber)).toBe(1);
  expect(runs[0].createdAt).toBeInstanceOf(Date);
  expect(runs[0].scheduledStartAt).toBeNull();
  expect(runs[0].startedAt).toBeNull();
  expect(runs[0].createdByUserId).toBeNull();

  // Only the four known states are accepted.
  await expect(sql`
    INSERT INTO "ExperimentRun" ("id", "projectId", "branchId", "experimentId", "configRevisionHash", "configSnapshot", "state", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${projectId}, 'main', 'exp-2', 'hash-2', '{}'::jsonb, 'ARCHIVED'::"ExperimentRunState", NOW())
  `).rejects.toThrow(/invalid input value for enum/);

  // An unknown project is rejected by the foreign key.
  await expect(sql`
    INSERT INTO "ExperimentRun" ("id", "projectId", "branchId", "experimentId", "configRevisionHash", "configSnapshot", "updatedAt")
    VALUES (${randomUUID()}::uuid, ${'nonexistent-' + randomUUID()}, 'main', 'exp-3', 'hash-3', '{}'::jsonb, NOW())
  `).rejects.toThrow(/ExperimentRun_projectId_fkey/);

  // Audit log rows accept nullable actor/before/after and default createdAt.
  const auditId = randomUUID();
  await sql`
    INSERT INTO "FeatureFlagAuditLog" ("id", "projectId", "branchId", "resourceType", "resourceId", "action", "actorType", "source")
    VALUES (${auditId}::uuid, ${projectId}, 'main', 'experiment_run', ${runId}, 'created', 'system', 'schedule_processor')
  `;
  const audits = await sql`SELECT "actorId", "beforeState", "afterState", "createdAt" FROM "FeatureFlagAuditLog" WHERE "id" = ${auditId}::uuid`;
  expect(audits).toHaveLength(1);
  expect(audits[0].actorId).toBeNull();
  expect(audits[0].beforeState).toBeNull();
  expect(audits[0].createdAt).toBeInstanceOf(Date);

  // Deleting the project cascades to both tables.
  await sql`DELETE FROM "Project" WHERE "id" = ${projectId}`;
  const remainingRuns = await sql`SELECT COUNT(*) AS count FROM "ExperimentRun" WHERE "projectId" = ${projectId}`;
  expect(Number(remainingRuns[0].count)).toBe(0);
  const remainingAudits = await sql`SELECT COUNT(*) AS count FROM "FeatureFlagAuditLog" WHERE "projectId" = ${projectId}`;
  expect(Number(remainingAudits[0].count)).toBe(0);
};
