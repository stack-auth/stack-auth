import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';
import { asObject, renderProviders } from './render-helpers';

// Old creation form: the whole `auth.oauth.providers` object (incl. enable fields)
// was written into the environment layer. A shared provider has no real credentials.
export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'whole-object-shared', '', false)`;

  const envConfig = {
    "auth.oauth.providers": {
      spotify: { type: "spotify", isShared: true, allowSignIn: true, allowConnectedAccounts: true },
    },
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(envConfig)})`;

  return { projectId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [branch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // Enable fields as a WHOLE OBJECT per provider (NOT leaf keys), so the renderer keeps them.
  expect(branch.config).toEqual({
    "auth.oauth.providers.spotify": { type: "spotify", allowSignIn: true, allowConnectedAccounts: true },
  });

  const [env] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // Credentials stay in env as leaf keys; enable fields are gone; no clobbering ancestor container.
  expect(env.config).toEqual({
    "auth.oauth.providers.spotify.isShared": true,
  });

  // Render-level guard: the migrated provider must survive into the rendered config.
  const providers = renderProviders(branch.config, env.config);
  expect(providers.spotify).toBeDefined();
  const spotify = asObject(providers.spotify);
  expect(spotify.type).toBe("spotify");
  expect(spotify.isShared).toBe(true);
};
