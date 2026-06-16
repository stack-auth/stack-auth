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
  console.warn(`[internal-tool] spacetime publish failed (status ${publish.status}); skipping token provisioning.`);
  process.exit(0);
}

try {
  await provisionServiceToken();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[internal-tool] Token provisioning failed unexpectedly: ${message}`);
  console.warn("[internal-tool] Continuing dev startup; backend SpacetimeDB features may error until STACK_SPACETIMEDB_SERVICE_TOKEN is set manually.");
}

async function provisionServiceToken() {
  const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
  const spacetimeHttpUrl = `http://127.0.0.1:${portPrefix}39`;
  const dbName = process.env.STACK_SPACETIMEDB_DB_NAME ?? "hexclave-ai-analytics";
  const backendEnvLocal = resolve("../backend/.env.local");
  const backendEnvDevelopmentLocal = resolve("../backend/.env.development.local");
  const backendEnvDev = resolve("../backend/.env.development");
  const backendDevEnvReadOrder = [
    backendEnvDevelopmentLocal,
    backendEnvLocal,
    backendEnvDev,
  ];
  // This script only runs before `next dev`. If a developer already uses
  // .env.local, keep all local-only overrides there so `next build`/`next start`
  // repros see the same token. Otherwise, avoid creating .env.local and keep the
  // auto-minted dev token scoped to development.
  const backendEnvWriteTarget = existsSync(backendEnvLocal) ? backendEnvLocal : backendEnvDevelopmentLocal;

  let existingToken = null;
  for (const filePath of backendDevEnvReadOrder) {
    existingToken = readEnvVar(filePath, "STACK_SPACETIMEDB_SERVICE_TOKEN");
    if (existingToken) break;
  }

  if (existingToken) {
    const stillValid = await probeToken(spacetimeHttpUrl, dbName, existingToken);
    if (stillValid) {
      return;
    }
    console.log("[internal-tool] Existing STACK_SPACETIMEDB_SERVICE_TOKEN is stale; re-minting...");
    removeEnvVar(backendEnvLocal, "STACK_SPACETIMEDB_SERVICE_TOKEN");
    removeEnvVar(backendEnvDevelopmentLocal, "STACK_SPACETIMEDB_SERVICE_TOKEN");
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
    console.warn(`[internal-tool] /v1/identity returned no usable token field; skipping write to ${backendEnvWriteTarget}. Backend SpacetimeDB features will error until STACK_SPACETIMEDB_SERVICE_TOKEN is set manually.`);
    return;
  }

  const existingContent = existsSync(backendEnvWriteTarget) ? readFileSync(backendEnvWriteTarget, "utf8") : "";
  const prefix = existingContent && !existingContent.endsWith("\n") ? "\n" : "";
  appendFileSync(
    backendEnvWriteTarget,
    `${prefix}# Auto-provisioned by apps/internal-tool/scripts/pre-dev.mjs\nSTACK_SPACETIMEDB_SERVICE_TOKEN=${token}\n`,
  );
  console.log(`[internal-tool] Wrote STACK_SPACETIMEDB_SERVICE_TOKEN to ${backendEnvWriteTarget}`);
  if (backendEnvWriteTarget === backendEnvDevelopmentLocal) {
    console.log("[internal-tool] For local `next build`/`next start` repros, move this token to apps/backend/.env.local.");
  }
  console.log("[internal-tool] Restart the backend dev server if already running to pick up the new env var.");
}

async function probeToken(spacetimeHttpUrl, dbName, token) {
  try {
    const res = await fetch(`${spacetimeHttpUrl}/v1/database/${encodeURIComponent(dbName)}/sql`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: "SELECT 1",
    });
    if (res.status === 401) return false;
    if (res.ok) return true;
    return true;
  } catch {
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
  const pattern = new RegExp(
    `(^# Auto-provisioned by apps/internal-tool/scripts/pre-dev\\.mjs\\n)?^${key}=.*\\n?`,
    "m",
  );
  const updated = content.replace(pattern, "");
  writeFileSync(filePath, updated, "utf8");
}
