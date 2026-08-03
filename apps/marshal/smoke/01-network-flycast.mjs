// Smoke 1: app creation on custom 6PN networks, flycast (private_v6) determinism,
// cross-network isolation, machine exec.
import { createApp, flyGraphql, flyMachines, log, machineExec, waitForMachineState } from "./lib.mjs";

const TARGET = "hxc-smoke-target";
const CALLER = "hxc-smoke-caller";
const OUTSIDER = "hxc-smoke-outsider";
const NET1 = "hxc-smoke-net1";
const NET2 = "hxc-smoke-net2";

// 1. Create apps on custom networks
for (const [name, net] of [[TARGET, NET1], [CALLER, NET1], [OUTSIDER, NET2]]) {
  const r = await createApp(name, net);
  log(`createApp ${name} net=${net} -> ${r.status} [${r.ms}ms]`, JSON.stringify(r.json).slice(0, 200));
}

// 2. Allocate flycast (private_v6) on target, on its custom network
const alloc = await flyGraphql(`
  mutation($input: AllocateIPAddressInput!) {
    allocateIpAddress(input: $input) { ipAddress { id address type } }
  }`, { input: { appId: TARGET, type: "private_v6", network: NET1 } });
log("allocate flycast:", JSON.stringify(alloc.json));

// 3. Create target machine: nginx with http service (autostop/autostart for later tests)
const targetMachine = await flyMachines(`/apps/${TARGET}/machines`, {
  method: "POST",
  body: {
    name: "target-1",
    region: "iad",
    config: {
      image: "nginx:alpine",
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
      metadata: { hexclave_revision: "smoke-rev-1", hexclave_ns: "smokens", hexclave_key: "target" },
      services: [{
        internal_port: 80,
        protocol: "tcp",
        autostop: "stop",
        autostart: true,
        ports: [{ port: 80, handlers: ["http"] }],
        concurrency: { type: "requests", soft_limit: 25 },
      }],
    },
  },
});
log(`create target machine -> ${targetMachine.status} [${targetMachine.ms}ms] id=${targetMachine.json.id} state=${targetMachine.json.state}`);
const targetId = targetMachine.json.id;

// 4. Create caller machine (same network) and outsider machine (other network)
async function createSleeper(app, name) {
  const r = await flyMachines(`/apps/${app}/machines`, {
    method: "POST",
    body: {
      name,
      region: "iad",
      config: {
        image: "alpine:3.20",
        guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
        init: { exec: ["/bin/sleep", "infinity"] },
      },
    },
  });
  log(`create sleeper ${app}/${name} -> ${r.status} [${r.ms}ms] id=${r.json.id}`);
  return r.json.id;
}
const callerId = await createSleeper(CALLER, "caller-1");
const outsiderId = await createSleeper(OUTSIDER, "outsider-1");

// 5. Wait for all machines to start
for (const [app, id] of [[TARGET, targetId], [CALLER, callerId], [OUTSIDER, outsiderId]]) {
  const w = await waitForMachineState(app, id, "started", { timeoutSec: 60 });
  log(`wait ${app}/${id} started -> ${w.status} [${w.ms}ms]`, JSON.stringify(w.json).slice(0, 100));
}

// 6. From caller (same net): flycast should route to target nginx
const inNet = await machineExec(CALLER, callerId, ["wget", "-qO-", "-T", "10", `http://${TARGET}.flycast/`]);
log(`caller -> ${TARGET}.flycast: status=${inNet.status}`, JSON.stringify(inNet.json).slice(0, 300));

// 7. From outsider (different net): should NOT resolve/route
const outNet = await machineExec(OUTSIDER, outsiderId, ["wget", "-qO-", "-T", "10", `http://${TARGET}.flycast/`]);
log(`outsider -> ${TARGET}.flycast: status=${outNet.status}`, JSON.stringify(outNet.json).slice(0, 300));

// 8. Also check .internal DNS isolation
const inInternal = await machineExec(CALLER, callerId, ["nslookup", `${TARGET}.internal`]);
log(`caller nslookup ${TARGET}.internal:`, JSON.stringify(inInternal.json).slice(0, 300));
const outInternal = await machineExec(OUTSIDER, outsiderId, ["nslookup", `${TARGET}.internal`]);
log(`outsider nslookup ${TARGET}.internal:`, JSON.stringify(outInternal.json).slice(0, 300));

log("DONE. Machines left running for scripts 02/03 (cleanup in 99-cleanup.mjs).");
