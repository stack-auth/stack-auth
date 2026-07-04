#!/usr/bin/env node
// Runs before `next dev`. Publishes the SpacetimeDB module to the local server
// if the spacetime CLI is installed. Otherwise, warns and continues so the dev
// server still starts (useful in CI and for contributors who haven't installed
// the CLI yet).
//
// No token provisioning is needed: this app is the OIDC issuer for
// SpacetimeDB tokens (it serves the discovery document + JWKS, mints tokens
// for signed-in users, and mints its own service tokens for telemetry
// ingested from the backend over HTTP). SpacetimeDB validates tokens via
// OIDC discovery against this app's dev server (reachable from the container
// through the spacetimedb-issuer-proxy sidecar in docker/dependencies).

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { exportJWK, generateKeyPair } from "jose";

// Provision a unique, per-developer ES256 signing key for SpacetimeDB tokens
// into the gitignored .env.local, so no private key material ships in git and
// no key is shared across environments. Runs once: if a real key is already
// present we leave it untouched (regenerating would invalidate live tokens and
// force SpacetimeDB to re-fetch the JWKS). .env.local overrides the REPLACE_ME
// placeholder in .env.development, and Next loads it before the dev server
// mints its first token.
const ENV_LOCAL = resolve(".env.local");
const SIGNING_KEY_VAR = "STACK_SPACETIMEDB_SIGNING_KEY_JWK";

async function ensureSigningKey() {
  const existing = existsSync(ENV_LOCAL) ? readFileSync(ENV_LOCAL, "utf8") : "";
  const line = existing.split(/\r?\n/).find((l) => l.startsWith(`${SIGNING_KEY_VAR}=`));
  const value = line ? line.slice(SIGNING_KEY_VAR.length + 1).trim() : "";
  if (value !== "" && value !== "REPLACE_ME") return;

  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = await exportJWK(privateKey);
  jwk.kid = `spacetimedb-dev-${Date.now()}`;
  jwk.alg = "ES256";

  const prefix = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(
    ENV_LOCAL,
    `${prefix}# Auto-generated per-developer ES256 SpacetimeDB signing key (gitignored; do not commit or reuse in prod).\n${SIGNING_KEY_VAR}=${JSON.stringify(jwk)}\n`,
    "utf8",
  );
  console.log(`[internal-tool] Generated a local SpacetimeDB signing key in .env.local`);
}

await ensureSigningKey();

const which = spawnSync(process.platform === "win32" ? "where" : "which", ["spacetime"], {
  stdio: "ignore",
});

if (which.status !== 0) {
  console.warn("\n[internal-tool] spacetime CLI not found, skipping publish.");
  console.warn("[internal-tool] To install it: curl -sSf https://install.spacetimedb.com | sh\n");
  process.exit(0);
}

const publish = spawnSync("pnpm", ["spacetime:publish:local"], {
  stdio: "inherit",
});

if (publish.status !== 0) {
  console.warn(`[internal-tool] spacetime publish failed (status ${publish.status}).`);
  process.exit(0);
}
