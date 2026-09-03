#!/usr/bin/env node
// Cross-platform token injection/restoration for SpacetimeDB publish.
// Replaces the Unix-only sed/mv scripts so pnpm dev works on Windows too.

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = resolve("spacetimedb/src/index.ts");
const BACKUP = TARGET + ".bak";
const PLACEHOLDER = "__SPACETIMEDB_LOG_TOKEN__";

const action = process.argv[2];

function resolveHexclaveStackEnvVar(hexclaveName, stackName) {
  const hexclaveValue = process.env[hexclaveName];
  const stackValue = process.env[stackName];
  if (hexclaveValue && stackValue && hexclaveValue !== stackValue) {
    throw new Error(`Environment variables ${hexclaveName} and ${stackName} are both set to different values. Remove one of them or set them to the same value.`);
  }
  return hexclaveValue || stackValue || undefined;
}

if (action === "inject") {
  const token = resolveHexclaveStackEnvVar("HEXCLAVE_MCP_LOG_TOKEN", "STACK_MCP_LOG_TOKEN") || "change-me";
  if (existsSync(BACKUP)) {
    console.error("Refusing to inject: backup already exists. Run restore first.");
    process.exit(1);
  }
  const content = readFileSync(TARGET, "utf8");
  writeFileSync(BACKUP, content, "utf8");
  const escapedToken = JSON.stringify(token).slice(1, -1);
  writeFileSync(TARGET, content.replaceAll(PLACEHOLDER, escapedToken), "utf8");
} else if (action === "restore") {
  if (existsSync(BACKUP)) {
    if (existsSync(TARGET)) {
      unlinkSync(TARGET);
    }
    renameSync(BACKUP, TARGET);
  }
} else {
  console.error("Usage: node scripts/spacetime-token.mjs <inject|restore>");
  process.exit(1);
}
