import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';
import { asObject, getIn, renderConfig } from './render-helpers';

// The hard case: env stores a single NESTED `auth` object that holds BOTH the providers
// map and other auth content (password, oauth.accountMergeStrategy, the signUpRules
// record). Naively keeping `auth` (or `auth.oauth`) as an object in env would, via
// override(branch, env), clobber the branch's `auth.oauth.providers.<id>` roster (env key
// is an ancestor). The migration must lift the `auth`/`auth.oauth` spine to dotted keys
// while keeping off-spine records (signUpRules) whole — so the provider renders AND the
// other auth config survives.
export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const ruleId = randomUUID();
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'nested-auth-spine', '', false)`;

  const envConfig = {
    auth: {
      allowSignUp: true,
      password: { allowSignIn: true },
      oauth: {
        accountMergeStrategy: "link_method",
        providers: { spotify: { type: "spotify", isShared: true, allowSignIn: true, allowConnectedAccounts: true } },
      },
      signUpRules: { [ruleId]: { enabled: true, priority: 0, action: { type: "allow" } } },
    },
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(envConfig)})`;

  return { projectId, ruleId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [branch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  expect(branch.config).toEqual({
    "auth.oauth.providers.spotify": { type: "spotify", allowSignIn: true, allowConnectedAccounts: true },
  });

  const [env] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // The providers-ancestor spine is lifted to dotted keys: no `auth` / `auth.oauth` /
  // `auth.oauth.providers` OBJECT remains to clobber the branch roster.
  expect("auth" in env.config).toBe(false);
  expect("auth.oauth" in env.config).toBe(false);
  expect("auth.oauth.providers" in env.config).toBe(false);
  // Off-spine auth content preserved (records kept whole; scalars/objects by value).
  expect(env.config["auth.allowSignUp"]).toBe(true);
  expect(env.config["auth.password"]).toEqual({ allowSignIn: true });
  expect(env.config["auth.oauth.accountMergeStrategy"]).toBe("link_method");
  expect(env.config["auth.signUpRules"]).toEqual({ [ctx.ruleId]: { enabled: true, priority: 0, action: { type: "allow" } } });
  // Spotify credential leaf only (shared => isShared).
  expect(env.config["auth.oauth.providers.spotify.isShared"]).toBe(true);

  // Render-level guard: spotify is NOT clobbered (renders with its branch type), and the
  // other auth config (password, signUpRules record) survives.
  const rendered = renderConfig(branch.config, env.config);
  const providers = getIn(rendered, ['auth', 'oauth', 'providers']);
  expect(providers.spotify).toBeDefined();
  expect(asObject(providers.spotify).type).toBe("spotify");
  expect(getIn(rendered, ['auth', 'password']).allowSignIn).toBe(true);
  expect(getIn(rendered, ['auth', 'signUpRules', ctx.ruleId]).enabled).toBe(true);
};
