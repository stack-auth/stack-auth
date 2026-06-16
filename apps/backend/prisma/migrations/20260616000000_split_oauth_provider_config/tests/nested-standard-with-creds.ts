import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';
import { asObject, renderProviders } from './render-helpers';

// Fully-nested environment config (e.g. written via a rendered config file) with a
// standard provider that has real credentials, including a nested appleBundles map.
export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const bundleId = randomUUID();
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'nested-standard', '', false)`;

  const envConfig = {
    auth: {
      oauth: {
        providers: {
          apple: {
            type: "apple",
            isShared: false,
            clientId: "cid",
            clientSecret: "sec",
            allowSignIn: true,
            allowConnectedAccounts: true,
            appleBundles: { [bundleId]: { bundleId: "com.example.app" } },
          },
        },
      },
    },
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(envConfig)})`;

  return { projectId, bundleId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [branch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // Enable fields as a WHOLE OBJECT per provider (NOT leaf keys), so the renderer keeps them.
  expect(branch.config).toEqual({
    "auth.oauth.providers.apple": { type: "apple", allowSignIn: true, allowConnectedAccounts: true },
  });

  const [env] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // Credentials as FIELD-level leaf keys. `appleBundles` is a record-typed field, so it
  // must stay a WHOLE OBJECT leaf (matching splitOAuthProvider) — deep-flattening it into
  // `...appleBundles.<id>.bundleId` would drop the bundles at render (no container default).
  expect(env.config).toEqual({
    "auth.oauth.providers.apple.isShared": false,
    "auth.oauth.providers.apple.clientId": "cid",
    "auth.oauth.providers.apple.clientSecret": "sec",
    "auth.oauth.providers.apple.appleBundles": { [ctx.bundleId]: { bundleId: "com.example.app" } },
  });

  // Render-level guard: the migrated provider must survive with both its branch enable
  // fields and its env credentials — including the Apple bundle IDs — merged in.
  const providers = renderProviders(branch.config, env.config);
  expect(providers.apple).toBeDefined();
  const apple = asObject(providers.apple);
  expect(apple.type).toBe("apple");
  expect(apple.clientId).toBe("cid");
  expect(asObject(asObject(apple.appleBundles)[ctx.bundleId]).bundleId).toBe("com.example.app");
};
