#!/usr/bin/env node
// Cross-platform token injection/restoration for SpacetimeDB publish.
// Replaces the Unix-only sed/mv scripts so pnpm dev works on Windows too.

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = resolve("spacetimedb/src/index.ts");
const BACKUP = TARGET + ".bak";
const PLACEHOLDER = "__SPACETIMEDB_LOG_TOKEN__";

const action = process.argv[2];

if (action === "inject") {
  const token = process.env.STACK_MCP_LOG_TOKEN || "change-me";
  const content = readFileSync(TARGET, "utf8");
  writeFileSync(BACKUP, content, "utf8");
  writeFileSync(TARGET, content.replaceAll(PLACEHOLDER, token), "utf8");
} else if (action === "restore") {
  if (existsSync(BACKUP)) {
    unlinkSync(TARGET);
    renameSync(BACKUP, TARGET);
  }
} else {
  console.error("Usage: node scripts/spacetime-token.mjs <inject|restore>");
  process.exit(1);
}
