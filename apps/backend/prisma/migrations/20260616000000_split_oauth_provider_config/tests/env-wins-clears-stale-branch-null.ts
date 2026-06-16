import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';
import { asObject, renderProviders } from './render-helpers';

// The exact stranded state we set out to fix: env has spotify enabled (so it
// renders enabled today, env wins), while the branch carries a stale disable marker
// `{"auth.oauth.providers.spotify": null}` that never took effect. The migration
// must (env-wins) re-enable spotify in branch and clear the stale null, so the
// rendered roster is unchanged AND the provider becomes disable-able for real.
export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'env-wins', '', false)`;

  const envConfig = {
    "auth.oauth.providers.spotify": { type: "spotify", isShared: true, allowSignIn: true, allowConnectedAccounts: true },
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(envConfig)})`;

  const branchConfig = { "auth.oauth.providers.spotify": null };
  await sql`INSERT INTO "BranchConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config", "source") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(branchConfig)}, ${sql.json({ type: "unlinked" })})`;

  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [branch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // Stale null is gone; spotify is enabled in branch (env-wins) as a WHOLE OBJECT.
  expect(branch.config).toEqual({
    "auth.oauth.providers.spotify": { type: "spotify", allowSignIn: true, allowConnectedAccounts: true },
  });

  const [env] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  expect(env.config).toEqual({
    "auth.oauth.providers.spotify.isShared": true,
  });

  // Render-level guard: the stale null is cleared and spotify renders enabled.
  const providers = renderProviders(branch.config, env.config);
  expect(providers.spotify).toBeDefined();
  expect(asObject(providers.spotify).type).toBe("spotify");
};
