#!/usr/bin/env node
// Runs before `next dev`. Publishes the SpacetimeDB module to the local server
// if the spacetime CLI is installed, then provisions a service identity token
// for the backend if one isn't already set (or is stale). Otherwise, warns and
// continues so the dev server still starts (useful in CI and for contributors
// who haven't installed the CLI yet).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

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
  process.exit(publish.status ?? 1);
}

// Provision the backend's SpacetimeDB service token if missing or stale.
// Backend's mcp-logger.ts requires STACK_SPACETIMEDB_SERVICE_TOKEN to function.
await provisionServiceToken();

async function provisionServiceToken() {
  const portPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
  const spacetimeHttpUrl = `http://127.0.0.1:${portPrefix}39`;
  const dbName = process.env.STACK_SPACETIMEDB_DB_NAME ?? "stack-auth-llm";
  const backendEnvLocal = resolve("../backend/.env.development.local");
  const backendEnvDev = resolve("../backend/.env.development");

  // Check if the token is already configured in any env file the backend loads.
  const existingToken =
    readEnvVar(backendEnvLocal, "STACK_SPACETIMEDB_SERVICE_TOKEN") ||
    readEnvVar(backendEnvDev, "STACK_SPACETIMEDB_SERVICE_TOKEN");

  if (existingToken) {
    // Probe the token against the running SpacetimeDB. If it works, keep it.
    // If SpacetimeDB signing keys rotated (e.g. after OrbStack restart), the
    // token is dead — strip it from the env file and mint a fresh one.
    const stillValid = await probeToken(spacetimeHttpUrl, dbName, existingToken);
    if (stillValid) {
      return;
    }
    console.log("[internal-tool] Existing STACK_SPACETIMEDB_SERVICE_TOKEN is stale; re-minting...");
    removeEnvVar(backendEnvLocal, "STACK_SPACETIMEDB_SERVICE_TOKEN");
  } else {
    console.log("[internal-tool] Minting SpacetimeDB service token for backend...");
  }

  let token;
  try {
    const res = await fetch(`${spacetimeHttpUrl}/v1/identity`, { method: "POST" });
    if (!res.ok) {
      console.warn(`[internal-tool] Failed to mint service token: HTTP ${res.status}. Backend SpacetimeDB features will error until STACK_SPACETIMEDB_SERVICE_TOKEN is set manually.`);
      return;
    }
    const body = await res.json();
    token = body.token;
  } catch (err) {
    console.warn(`[internal-tool] Failed to mint service token: ${err.message}. Backend SpacetimeDB features will error until STACK_SPACETIMEDB_SERVICE_TOKEN is set manually.`);
    return;
  }

  if (typeof token !== "string" || token.trim() === "") {
    console.warn("[internal-tool] /v1/identity returned no usable token field; skipping write to .env.development.local. Backend SpacetimeDB features will error until STACK_SPACETIMEDB_SERVICE_TOKEN is set manually.");
    return;
  }

  const existingContent = existsSync(backendEnvLocal) ? readFileSync(backendEnvLocal, "utf8") : "";
  const prefix = existingContent && !existingContent.endsWith("\n") ? "\n" : "";
  appendFileSync(
    backendEnvLocal,
    `${prefix}# Auto-provisioned by apps/internal-tool/scripts/pre-dev.mjs\nSTACK_SPACETIMEDB_SERVICE_TOKEN=${token}\n`,
  );
  console.log(`[internal-tool] Wrote STACK_SPACETIMEDB_SERVICE_TOKEN to ${backendEnvLocal}`);
  console.log("[internal-tool] Restart the backend dev server if already running to pick up the new env var.");
}

async function probeToken(spacetimeHttpUrl, dbName, token) {
  try {
    // Cheapest valid request: a SQL query that the module owner / any identity
    // can run. Returns HTTP 200 if token signature is valid, 401 if not.
    const res = await fetch(`${spacetimeHttpUrl}/v1/database/${encodeURIComponent(dbName)}/sql`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: "SELECT 1",
    });
    if (res.status === 401) return false;
    if (res.ok) return true;
    // Any other status: be conservative, assume token is fine — we don't want
    // to wipe a valid token on a transient network error.
    return true;
  } catch {
    // Network error: can't confirm staleness; keep the existing token.
    return true;
  }
}

function readEnvVar(filePath, key) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf8");
  const match = content.match(new RegExp(`^${key}=(.+)$`, "m"));
  if (!match) return null;
  const value = match[1].trim();
  return value === "" ? null : value;
}

function removeEnvVar(filePath, key) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, "utf8");
  // Strip the env var line AND the auto-provisioning comment immediately above it.
  const pattern = new RegExp(
    `(^# Auto-provisioned by apps/internal-tool/scripts/pre-dev\\.mjs\\n)?^${key}=.*\\n?`,
    "m",
  );
  const updated = content.replace(pattern, "");
  writeFileSync(filePath, updated, "utf8");
}
