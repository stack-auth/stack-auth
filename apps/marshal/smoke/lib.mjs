// Shared helpers for the Marshal smoke tests (see ../SMOKE-RESULTS.md).
// Run from apps/marshal: `node smoke/<script>.mjs`. Requires .env.local.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=("?)(.*)\2$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
}

export const FLY_TOKEN = process.env.FLY_API_TOKEN;
export const FLY_ORG = process.env.FLY_ORG_SLUG;
export const MACHINES_API = "https://api.machines.dev/v1";
export const GRAPHQL_API = "https://api.fly.io/graphql";
export const LOGS_API = "https://api.fly.io/api/v1";

export function log(...args) {
  console.log(new Date().toISOString().slice(11, 23), ...args);
}

export async function flyMachines(path, { method = "GET", body, expectStatus } = {}) {
  const started = Date.now();
  const res = await fetch(`${MACHINES_API}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${FLY_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  const ms = Date.now() - started;
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(`${method} ${path} -> ${res.status} (expected ${expectStatus}) [${ms}ms]: ${text.slice(0, 2000)}`);
  }
  return { status: res.status, json, ms };
}

export async function flyGraphql(query, variables = {}) {
  const started = Date.now();
  const res = await fetch(GRAPHQL_API, {
    method: "POST",
    headers: { "Authorization": `Bearer ${FLY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return { status: res.status, json, ms: Date.now() - started };
}

export async function flyLogs(app, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const started = Date.now();
  // NB: the logs API rejects "Bearer <token>" — it requires the raw "FlyV1 fm2_..." scheme.
  const res = await fetch(`${LOGS_API}/apps/${app}/logs${qs ? `?${qs}` : ""}`, {
    headers: { "Authorization": FLY_TOKEN },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: Object.fromEntries(res.headers), ms: Date.now() - started };
}

export async function waitForMachineState(app, machineId, state, { timeoutSec = 60, instanceId } = {}) {
  const qs = new URLSearchParams({ state, timeout: String(timeoutSec) });
  if (instanceId) qs.set("instance_id", instanceId);
  return await flyMachines(`/apps/${app}/machines/${machineId}/wait?${qs}`);
}

export async function machineExec(app, machineId, command, { timeout = 30 } = {}) {
  return await flyMachines(`/apps/${app}/machines/${machineId}/exec`, {
    method: "POST",
    body: { command, timeout },
  });
}

export async function createApp(name, network) {
  return await flyMachines(`/apps`, {
    method: "POST",
    body: { app_name: name, org_slug: FLY_ORG, ...(network ? { network } : {}) },
  });
}

export async function deleteApp(name) {
  return await flyMachines(`/apps/${name}?force=true`, { method: "DELETE" });
}

export async function sleep(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}
