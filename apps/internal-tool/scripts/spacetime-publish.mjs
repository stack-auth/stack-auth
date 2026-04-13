#!/usr/bin/env node
// Cross-platform SpacetimeDB publish that injects the token, publishes, and
// always restores the original file — even on failure.

import { spawnSync } from "node:child_process";

const target = process.argv[2]; // "local" or "prod"

const configs = {
  local: ["publish", "stack-auth-llm", "--server", "local", "-p", "spacetimedb", "--yes", "--no-config", "--delete-data=on-conflict"],
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

// Inject token
const inject = spawnSync("node", ["scripts/spacetime-token.mjs", "inject"], { stdio: "inherit" });
if (inject.status !== 0) {
  process.exit(inject.status ?? 1);
}

try {
  const publish = spawnSync("spacetime", args, { stdio: "inherit" });
  process.exitCode = publish.status ?? 1;
} finally {
  spawnSync("node", ["scripts/spacetime-token.mjs", "restore"], { stdio: "inherit" });
}
