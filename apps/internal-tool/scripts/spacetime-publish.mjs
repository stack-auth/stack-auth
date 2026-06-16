#!/usr/bin/env node
// Cross-platform SpacetimeDB publish that injects the token, publishes, and
// always restores the original file — even on failure.

import { spawnSync } from "node:child_process";

const target = process.argv[2]; // "local" or "prod"

function resolveHexclaveStackEnvVar(hexclaveName, stackName) {
  const hexclaveValue = process.env[hexclaveName];
  const stackValue = process.env[stackName];
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}

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
    "stack-auth-llm",
    "--server",
    localPublishServerUrl(),
    "-p",
    "spacetimedb",
    "--yes",
    "--no-config",
    "--delete-data=on-conflict",
  ],
  prod: ["publish", "stack-auth-llm", "--server", "maincloud", "-p", "spacetimedb", "--yes", "--no-config"],
};

const args = configs[target];
if (!args) {
  console.error("Usage: node scripts/spacetime-publish.mjs <local|prod>");
  process.exit(1);
}

if (target === "prod" && !resolveHexclaveStackEnvVar("HEXCLAVE_MCP_LOG_TOKEN", "STACK_MCP_LOG_TOKEN")) {
  console.error("Error: HEXCLAVE_MCP_LOG_TOKEN (or legacy STACK_MCP_LOG_TOKEN) must be set for prod publish");
  process.exit(1);
}

let exitCode = 1;
try {
  const inject = spawnSync("node", ["scripts/spacetime-token.mjs", "inject"], { stdio: "inherit" });
  if (inject.status !== 0) {
    exitCode = inject.status ?? 1;
  } else {
    const publish = spawnSync("spacetime", args, { stdio: "inherit" });
    exitCode = publish.status ?? 1;
  }
} finally {
  const restore = spawnSync("node", ["scripts/spacetime-token.mjs", "restore"], { stdio: "inherit" });
  if (restore.status !== 0 && exitCode === 0) {
    exitCode = restore.status ?? 1;
  }
  process.exitCode = exitCode;
}
