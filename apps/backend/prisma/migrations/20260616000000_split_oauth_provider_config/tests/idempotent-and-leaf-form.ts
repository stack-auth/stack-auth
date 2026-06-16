import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';

// Two cases sharing one project pair:
//  A) An already-split project (env credentials-only, branch enable) must be left
//     untouched (idempotency / safe re-run).
//  B) A project whose env carries enable fields as dotted LEAF keys (dashboard write
//     shape) must still be migrated correctly.
export const preMigration = async (sql: Sql) => {
  const alreadySplitId = `test-${randomUUID()}`;
  const leafFormId = `test-${randomUUID()}`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${alreadySplitId}, NOW(), NOW(), 'already-split', '', false)`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${leafFormId}, NOW(), NOW(), 'leaf-form', '', false)`;

  // A) already split: env credentials-only (leaf keys), branch enable as a WHOLE OBJECT
  // (the shape the dashboard writes). The migration must leave this untouched.
  const alreadyEnv = { "auth.oauth.providers.google.isShared": false, "auth.oauth.providers.google.clientId": "cid" };
  const alreadyBranch = {
    "auth.oauth.providers.google": { type: "google", allowSignIn: true, allowConnectedAccounts: true },
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${alreadySplitId}, 'main', NOW(), NOW(), ${sql.json(alreadyEnv)})`;
  await sql`INSERT INTO "BranchConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config", "source") VALUES (${alreadySplitId}, 'main', NOW(), NOW(), ${sql.json(alreadyBranch)}, ${sql.json({ type: "unlinked" })})`;

  // B) leaf-form enable fields in env (shared github)
  const leafEnv = {
    "auth.oauth.providers.github.type": "github",
    "auth.oauth.providers.github.isShared": true,
    "auth.oauth.providers.github.allowSignIn": true,
    "auth.oauth.providers.github.allowConnectedAccounts": true,
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${leafFormId}, 'main', NOW(), NOW(), ${sql.json(leafEnv)})`;

  return { alreadySplitId, leafFormId, alreadyEnv, alreadyBranch };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  // A) unchanged
  const [aEnv] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.alreadySplitId} AND "branchId" = 'main'`;
  const [aBranch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.alreadySplitId} AND "branchId" = 'main'`;
  expect(aEnv.config).toEqual(ctx.alreadyEnv);
  expect(aBranch.config).toEqual(ctx.alreadyBranch);

  // B) migrated: enable fields land on the branch as a WHOLE OBJECT (not leaf keys).
  const [bBranch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.leafFormId} AND "branchId" = 'main'`;
  expect(bBranch.config).toEqual({
    "auth.oauth.providers.github": { type: "github", allowSignIn: true, allowConnectedAccounts: true },
  });
  const [bEnv] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.leafFormId} AND "branchId" = 'main'`;
  expect(bEnv.config).toEqual({ "auth.oauth.providers.github.isShared": true });
};
