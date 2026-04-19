#!/usr/bin/env node
// Cross-platform SpacetimeDB publish that injects the token, publishes, and
// always restores the original file — even on failure.

import { spawnSync } from "node:child_process";

const target = process.argv[2]; // "local" or "prod"

// SpacetimeDB in this repo runs in Docker (see docker/dependencies/docker.compose.yaml),
// with the container's port 3000 mapped to host port ${NEXT_PUBLIC_STACK_PORT_PREFIX:-81}39.
// We pass the full URL instead of `--server local` so the publish doesn't depend on each
// contributor's spacetime CLI config (the CLI's built-in `local` alias is http://127.0.0.1:3000).
const portPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX || "81";
const localServerUrl = `http://127.0.0.1:${portPrefix}39`;

const configs = {
  local: ["publish", "stack-auth-llm", "--server", localServerUrl, "-p", "spacetimedb", "--yes", "--no-config", "--delete-data=on-conflict"],
  prod: ["publish", "stack-auth-llm", "--server", "maincloud", "-p", "spacetimedb", "--yes", "--no-config"],
};

const args = configs[target];
if (!args) {
  console.error("Usage: node scripts/spacetime-publish.mjs <local|prod>");
  process.exit(1);
}

if (target === "prod" && !process.env.STACK_MCP_LOG_TOKEN) {
  console.error("Error: STACK_MCP_LOG_TOKEN must be set for prod publish");
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
