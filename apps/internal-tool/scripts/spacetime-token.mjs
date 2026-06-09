#!/usr/bin/env node
// Cross-platform token injection/restoration for SpacetimeDB publish.
// Replaces the Unix-only sed/mv scripts so pnpm dev works on Windows too.

import { readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = resolve("spacetimedb/src/index.ts");
const BACKUP = TARGET + ".bak";
const PLACEHOLDER = "__SPACETIMEDB_LOG_TOKEN__";

// This is a plain `node` script, so (unlike Next.js) it does NOT auto-load
// .env files. Without this, STACK_MCP_LOG_TOKEN is always undefined at publish
// time and the module bakes in the "change-me" default — while the Next.js
// client reads .env and sends whatever is configured there. The mismatch
// surfaces as "Invalid log token" on every eval reducer call. To stay
// consistent with the client, resolve env the same way Next.js does: load the
// dotenv cascade here, without overriding anything already in process.env.
function loadDotenv() {
  // Next.js dev precedence, highest first. We only *set* missing keys, so
  // earlier (higher-priority) files win — matching dotenv/Next semantics.
  const files = [".env.development.local", ".env.local", ".env.development", ".env"];
  for (const file of files) {
    const path = resolve(file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || key in process.env) continue;
      let value = line.slice(eq + 1).trim();
      // Strip matching surrounding quotes.
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      // "REPLACE_ME" is the .env template's not-filled-in sentinel; treat it as
      // unset so the token falls back to the "change-me" dev default — exactly
      // what src/lib/evals/config.ts's readEnv does on the client side. Keeping
      // both sides identical is what prevents "Invalid log token".
      if (value === "REPLACE_ME") continue;
      process.env[key] = value;
    }
  }
}

const action = process.argv[2];

if (action === "inject") {
  loadDotenv();
  const token = process.env.STACK_MCP_LOG_TOKEN || "change-me";
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
