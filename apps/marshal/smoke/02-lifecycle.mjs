// Smoke 2: machine lifecycle — get/update/stop/start, metadata endpoint, wait semantics.
import { flyMachines, log } from "./lib.mjs";

const TARGET = "hxc-smoke-target";

const list = await flyMachines(`/apps/${TARGET}/machines`);
const m = list.json[0];
log(`machine ${m.id} state=${m.state} region=${m.region} metadata=`, JSON.stringify(m.config?.metadata));

// Metadata endpoint (used for revision tracking)
const metaGet = await flyMachines(`/apps/${TARGET}/machines/${m.id}/metadata`);
log(`GET metadata -> ${metaGet.status}`, JSON.stringify(metaGet.json));
const metaSet = await flyMachines(`/apps/${TARGET}/machines/${m.id}/metadata/hexclave_revision`, {
  method: "POST",
  body: { value: "smoke-rev-2" },
});
log(`POST metadata hexclave_revision -> ${metaSet.status}`, JSON.stringify(metaSet.json).slice(0, 200));
const metaGet2 = await flyMachines(`/apps/${TARGET}/machines/${m.id}/metadata`);
log(`GET metadata after set ->`, JSON.stringify(metaGet2.json));

// Update machine config in place (rolling-deploy primitive): change env, keep image.
const current = await flyMachines(`/apps/${TARGET}/machines/${m.id}`);
const cfg = current.json.config;
const updated = await flyMachines(`/apps/${TARGET}/machines/${m.id}`, {
  method: "POST",
  body: { config: { ...cfg, env: { ...(cfg.env ?? {}), SMOKE_UPDATE: "1" } } },
});
log(`update machine -> ${updated.status} [${updated.ms}ms] state=${updated.json.state} instance_id=${updated.json.instance_id}`);

// Wait for started after update, using instance_id per docs
const w = await flyMachines(`/apps/${TARGET}/machines/${m.id}/wait?state=started&timeout=60&instance_id=${updated.json.instance_id}`);
log(`wait started after update -> ${w.status} [${w.ms}ms]`, JSON.stringify(w.json).slice(0, 120));

// Verify env applied
const after = await flyMachines(`/apps/${TARGET}/machines/${m.id}`);
log(`env after update:`, JSON.stringify(after.json.config.env), `metadata:`, JSON.stringify(after.json.config.metadata));

// Manual stop + wait stopped + start + wait started (timings)
const stop = await flyMachines(`/apps/${TARGET}/machines/${m.id}/stop`, { method: "POST" });
log(`stop -> ${stop.status} [${stop.ms}ms]`);
const ws = await flyMachines(`/apps/${TARGET}/machines/${m.id}/wait?state=stopped&timeout=60`);
log(`wait stopped -> ${ws.status} [${ws.ms}ms]`);
const start = await flyMachines(`/apps/${TARGET}/machines/${m.id}/start`, { method: "POST" });
log(`start -> ${start.status} [${start.ms}ms]`);
const ws2 = await flyMachines(`/apps/${TARGET}/machines/${m.id}/wait?state=started&timeout=60`);
log(`wait started -> ${ws2.status} [${ws2.ms}ms]`);
log("DONE");
