#!/usr/bin/env node
// Cross-platform SpacetimeDB publish that injects the allowed-issuers/audience
// auth config, publishes, and always restores the original file — even on
// failure.

import { spawnSync } from "node:child_process";

const target = process.argv[2]; // "local" or "prod"
const dbName = process.env.STACK_SPACETIMEDB_DB_NAME ?? "hexclave-ai-analytics";

/** HTTP API for 'spacetime publish' (matches docker/dependencies/docker.compose.yaml host port ...39). */
function localPublishServerUrl() {
  const publishUrl = resolveHexclaveStackEnvVar("HEXCLAVE_SPACETIME_PUBLISH_URL", "STACK_SPACETIME_PUBLISH_URL");
  if (publishUrl) {
    return publishUrl;
  }
  const prefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
  return `http://127.0.0.1:${prefix}39`;
}

const configs = {
  local: [
    "publish",
    dbName,
    "--server",
    localPublishServerUrl(),
    "-p",
    "spacetimedb",
    "--yes",
    "--no-config",
    "--delete-data=on-conflict",
  ],
  prod: ["publish", dbName, "--server", "maincloud", "-p", "spacetimedb", "--no-config"],
};

const args = configs[target];
if (!args) {
  console.error("Usage: node scripts/spacetime-publish.mjs <local|prod>");
  process.exit(1);
}

if (target === "prod" && !process.env.STACK_SPACETIMEDB_ALLOWED_ISSUERS && !process.env.STACK_SPACETIMEDB_TOKEN_ISSUER) {
  console.error("Error: STACK_SPACETIMEDB_TOKEN_ISSUER (or STACK_SPACETIMEDB_ALLOWED_ISSUERS) must be set for prod publish — the deployed internal tool's public URL, which serves the OIDC discovery document SpacetimeDB validates tokens against.");
  process.exit(1);
}

let exitCode = 1;
try {
  const inject = spawnSync("node", ["scripts/spacetime-auth-config.mjs", "inject"], { stdio: "inherit" });
  if (inject.status !== 0) {
    exitCode = inject.status ?? 1;
  } else {
    const publish = spawnSync("spacetime", args, { stdio: "inherit" });
    exitCode = publish.status ?? 1;
  }
} finally {
  const restore = spawnSync("node", ["scripts/spacetime-auth-config.mjs", "restore"], { stdio: "inherit" });
  if (restore.status !== 0 && exitCode === 0) {
    exitCode = restore.status ?? 1;
  }
  process.exitCode = exitCode;
}
