// Smoke 6: the build pipeline — ephemeral BuildKit machine fetches tarball from R2,
// builds the Dockerfile, pushes to registry.fly.io, then we deploy the digest to a
// separate app and verify it serves through flycast. Also validates that logs survive
// auto_destroy (load-bearing: the digest is scraped from logs here, and Marshal's
// live build-log proxy reads the builder machine's logs).
//
// NOTE: the inline script below is a point-in-time copy predating the dockerfilePath /
// Railpack harness (src/builds.ts buildHarnessScript) — it validates the Fly build
// mechanics, not the shipped harness. Re-verify harness changes against real Fly
// separately (or port this script to import buildHarnessScript).
import { createApp, flyGraphql, flyLogs, flyMachines, FLY_TOKEN, log, machineExec, sleep, waitForMachineState } from "./lib.mjs";

const BUILDER_APP = "hxc-smoke-builder";
const DEPLOY_APP = "hxc-smoke-deploy";
const CALLER = "hxc-smoke-caller";
const NET1 = "hxc-smoke-net1";
const TAG = "smokerev1";
const PUSH_TARGET = `registry.fly.io/${DEPLOY_APP}:${TAG}`;
const TARBALL_URL = `${process.env.S3_PUBLIC_URL}/marshal-smoke/ctx.tar.gz`;

for (const app of [BUILDER_APP, DEPLOY_APP]) {
  const r = await createApp(app, NET1);
  log(`createApp ${app} -> ${r.status}`);
}

const buildScript = `#!/bin/sh
set -e
echo "SMOKE_BUILD_START"
buildkitd >/tmp/buildkitd.log 2>&1 &
i=0
while ! buildctl debug workers >/dev/null 2>&1; do
  i=$((i+1)); [ $i -gt 60 ] && echo "BUILDKITD_TIMEOUT" && cat /tmp/buildkitd.log && exit 1
  sleep 1
done
mkdir -p /ctx && cd /ctx
wget -q -O ctx.tar.gz "$TARBALL_URL"
tar xzf ctx.tar.gz
[ -f Dockerfile ] || { echo "NO_DOCKERFILE_AT_ROOT"; exit 1; }
mkdir -p /root/.docker
printf '{"auths":{"registry.fly.io":{"auth":"%s"}}}' "$REGISTRY_AUTH_B64" > /root/.docker/config.json
buildctl build --frontend dockerfile.v0 --local context=. --local dockerfile=. \\
  --output type=image,name=$PUSH_TARGET,push=true --metadata-file /tmp/md.json
echo "BUILD_DIGEST:$(sed -n 's/.*"containerimage.digest":"\\([^"]*\\)".*/\\1/p' /tmp/md.json)"
echo "SMOKE_BUILD_DONE"
`;

const registryAuthB64 = Buffer.from(`x:${FLY_TOKEN}`).toString("base64");
const started = Date.now();
const builder = await flyMachines(`/apps/${BUILDER_APP}/machines`, {
  method: "POST",
  body: {
    name: "build-1",
    region: "iad",
    config: {
      image: "moby/buildkit:latest",
      guest: { cpu_kind: "shared", cpus: 2, memory_mb: 2048 },
      auto_destroy: true,
      restart: { policy: "no" },
      init: { exec: ["/bin/sh", "/build.sh"] },
      files: [{ guest_path: "/build.sh", raw_value: Buffer.from(buildScript).toString("base64") }],
      env: {
        TARBALL_URL,
        PUSH_TARGET,
        REGISTRY_AUTH_B64: registryAuthB64,
      },
    },
  },
});
log(`create builder machine -> ${builder.status} [${builder.ms}ms] id=${builder.json.id}`);
if (builder.status !== 200) {
  console.log(JSON.stringify(builder.json));
  process.exit(1);
}
const builderId = builder.json.id;

// Poll machine state until it disappears (auto_destroy) or 8 min pass
let machineGone = false;
for (let i = 0; i < 96; i++) {
  await sleep(5000);
  const m = await flyMachines(`/apps/${BUILDER_APP}/machines/${builderId}`);
  if (m.status === 404) { machineGone = true; log(`machine destroyed after ${((Date.now() - started) / 1000).toFixed(0)}s`); break; }
  if (i % 6 === 0) log(`builder state: ${m.json.state}`);
  if (m.json.state === "destroyed") { machineGone = true; break; }
  if (m.json.state === "stopped" || m.json.state === "failed") { log(`terminal state ${m.json.state}`); break; }
}

// Scrape logs (also validates logs survive machine destruction)
await sleep(3000);
const logs = await flyLogs(BUILDER_APP);
const lines = (logs.json.data ?? []).map((e) => e.attributes.message);
log(`builder logs after destroy: ${logs.status}, ${lines.length} lines, machineGone=${machineGone}`);
console.log(lines.filter((l) => /SMOKE_|BUILD_DIGEST|error|ERROR|naming to|exporting|DONE/.test(l)).join("\n").slice(0, 3000));
const digestLine = lines.find((l) => l.includes("BUILD_DIGEST:"));
if (!digestLine) {
  console.log("--- full log tail ---");
  console.log(lines.slice(-40).join("\n"));
  throw new Error("no digest found in logs");
}
const digest = digestLine.split("BUILD_DIGEST:")[1].trim();
log(`digest: ${digest}`);

// Deploy the built image (by digest) into DEPLOY_APP with a flycast IP
const alloc = await flyGraphql(`
  mutation($input: AllocateIPAddressInput!) { allocateIpAddress(input: $input) { ipAddress { address type } } }`,
  { input: { appId: DEPLOY_APP, type: "private_v6", network: NET1 } });
log("flycast for deploy app:", JSON.stringify(alloc.json));

const imageRef = `registry.fly.io/${DEPLOY_APP}@${digest}`;
const dm = await flyMachines(`/apps/${DEPLOY_APP}/machines`, {
  method: "POST",
  body: {
    name: "svc-1",
    region: "iad",
    config: {
      image: imageRef,
      guest: { cpu_kind: "shared", cpus: 1, memory_mb: 256 },
      metadata: { hexclave_revision: TAG },
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
log(`create deploy machine from ${imageRef} -> ${dm.status} [${dm.ms}ms] id=${dm.json.id}`);
if (dm.status !== 200) { console.log(JSON.stringify(dm.json)); process.exit(1); }
const w = await waitForMachineState(DEPLOY_APP, dm.json.id, "started", { timeoutSec: 120 });
log(`wait started -> ${w.status} [${w.ms}ms]`);

// Verify from the caller machine through flycast
const callerList = await flyMachines(`/apps/${CALLER}/machines`);
const callerId = callerList.json[0].id;
const probe = await machineExec(CALLER, callerId, ["wget", "-qO-", "-T", "10", `http://${DEPLOY_APP}.flycast/`]);
log(`caller -> ${DEPLOY_APP}.flycast:`, JSON.stringify(probe.json).slice(0, 300));
log(`total: ${((Date.now() - started) / 1000).toFixed(0)}s`);
log("DONE");
