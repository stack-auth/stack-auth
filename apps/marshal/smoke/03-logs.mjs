// Smoke 3: the HTTP logs API — response shape, cursor pagination, instance filter,
// behavior on custom-network apps and nonexistent apps.
import { flyLogs, flyMachines, log } from "./lib.mjs";

const TARGET = "hxc-smoke-target";

const list = await flyMachines(`/apps/${TARGET}/machines`);
const machineId = list.json[0].id;

// Base fetch — inspect shape + headers
const r1 = await flyLogs(TARGET);
log(`GET logs -> ${r1.status} [${r1.ms}ms]`);
log("headers:", JSON.stringify(Object.fromEntries(Object.entries(r1.headers).filter(([k]) => !k.startsWith("cf-") && !["date", "server", "vary", "via"].includes(k)))));
const body = r1.json;
log("body type:", typeof body, Array.isArray(body) ? "array" : "");
console.log(JSON.stringify(body, null, 2).slice(0, 3000));

// Cursor: try next_token if present
const token = body?.next_token ?? body?.meta?.next_token;
if (token) {
  const r2 = await flyLogs(TARGET, { next_token: token });
  log(`GET logs?next_token -> ${r2.status}, entries=${JSON.stringify(r2.json).length} chars`);
  console.log(JSON.stringify(r2.json).slice(0, 800));
}

// Instance filter
const r3 = await flyLogs(TARGET, { instance: machineId });
log(`GET logs?instance=${machineId} -> ${r3.status}`);
console.log(JSON.stringify(r3.json).slice(0, 800));

// Nonexistent app
const r4 = await flyLogs("hxc-smoke-does-not-exist");
log(`GET logs (nonexistent app) -> ${r4.status}`, JSON.stringify(r4.json).slice(0, 300));
log("DONE");
