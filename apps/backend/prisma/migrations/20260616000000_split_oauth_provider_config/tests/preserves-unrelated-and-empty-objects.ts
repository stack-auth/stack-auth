import { randomUUID } from 'crypto';
import type { Sql } from 'postgres';
import { expect } from 'vitest';
import { asObject, getIn, renderConfig } from './render-helpers';

// Surgical + lossless: non-provider content must be preserved BY VALUE, never flattened
// into dotted leaves. Function-default records (domains.trustedDomains, payments.products)
// render their container to {}, so a leaf like `domains.trustedDomains.<id>.baseUrl` with
// no surviving `<id>` object would vanish at render. We must keep the whole entry object.
// A branch provider for a DIFFERENT provider (github) must also be left alone.
export const preMigration = async (sql: Sql) => {
  const projectId = `test-${randomUUID()}`;
  const productId = randomUUID();
  const domainId = randomUUID();
  await sql`INSERT INTO "Project" ("id", "createdAt", "updatedAt", "displayName", "description", "isProductionMode") VALUES (${projectId}, NOW(), NOW(), 'preserves', '', false)`;

  const envConfig = {
    auth: { oauth: { providers: { google: { type: "google", isShared: false, clientId: "cid", clientSecret: "sec", allowSignIn: true, allowConnectedAccounts: true } } } },
    // A function-default record stored NESTED with a meaningful empty price map.
    payments: { products: { [productId]: { prices: {} } } },
    // A dotted non-provider key (preserved as-is).
    "domains.allowLocalhost": true,
    // The reviewer's exact case: a trusted domain stored as a whole-object entry. The old
    // flatten would shred this into `.baseUrl`/`.handlerPath` leaves that drop at render.
    [`domains.trustedDomains.${domainId}`]: { baseUrl: "https://example.com", handlerPath: "/handler" },
  };
  await sql`INSERT INTO "EnvironmentConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(envConfig)})`;

  // A pre-existing branch provider (github) that is NOT present in env.
  const branchConfig = { "auth.oauth.providers.github": { type: "github", allowSignIn: true, allowConnectedAccounts: true } };
  await sql`INSERT INTO "BranchConfigOverride" ("projectId", "branchId", "createdAt", "updatedAt", "config", "source") VALUES (${projectId}, 'main', NOW(), NOW(), ${sql.json(branchConfig)}, ${sql.json({ type: "unlinked" })})`;

  return { projectId, productId, domainId };
};

export const postMigration = async (sql: Sql, ctx: Awaited<ReturnType<typeof preMigration>>) => {
  const [branch] = await sql`SELECT "config" FROM "BranchConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // github (branch-only) untouched; google enable fields added as a WHOLE OBJECT.
  expect(branch.config["auth.oauth.providers.github"]).toEqual({ type: "github", allowSignIn: true, allowConnectedAccounts: true });
  expect(branch.config["auth.oauth.providers.google"]).toEqual({ type: "google", allowSignIn: true, allowConnectedAccounts: true });

  const [env] = await sql`SELECT "config" FROM "EnvironmentConfigOverride" WHERE "projectId" = ${ctx.projectId} AND "branchId" = 'main'`;
  // Non-provider content preserved BY VALUE (not flattened): nested empty price map,
  // dotted boolean, and the whole trusted-domain entry object.
  expect(env.config.payments.products[ctx.productId].prices).toEqual({});
  expect(env.config["domains.allowLocalhost"]).toBe(true);
  expect(env.config[`domains.trustedDomains.${ctx.domainId}`]).toEqual({ baseUrl: "https://example.com", handlerPath: "/handler" });
  // google credentials remain as leaves; no enable fields and no clobbering ancestor.
  expect(env.config["auth.oauth.providers.google.isShared"]).toBe(false);
  expect(env.config["auth.oauth.providers.google.clientId"]).toBe("cid");
  expect(env.config["auth.oauth.providers.google.clientSecret"]).toBe("sec");
  expect("auth.oauth.providers.google.type" in env.config).toBe(false);
  expect("auth.oauth.providers" in env.config).toBe(false);

  // Render-level guard: the trusted domain (a function-default record entry) must survive,
  // and both providers must render with their type + credentials.
  const rendered = renderConfig(branch.config, env.config);
  const trustedDomains = getIn(rendered, ['domains', 'trustedDomains']);
  expect(trustedDomains[ctx.domainId]).toBeDefined();
  expect(asObject(trustedDomains[ctx.domainId]).baseUrl).toBe("https://example.com");
  const providers = getIn(rendered, ['auth', 'oauth', 'providers']);
  expect(asObject(providers.google).type).toBe("google");
  expect(asObject(providers.google).clientId).toBe("cid");
  expect(asObject(providers.github).type).toBe("github");
};
