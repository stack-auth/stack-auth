import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Freestyle, FreestyleApiError } from "freestyle";
import { DEFAULT_FREESTYLE_SNAPSHOT_ID } from "../src/lib/freestyle-vm-constants";

const NODE_VERSION = "24.18.1";
const NODE_ARCHIVE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`;
const NODE_ARCHIVE_SHA256 = "9f5eb6ac21845a66c493c91a253b1da32fd684e89e9b7202d4936982336be4ca";
const snapshotId = readHexclaveEnvironmentVariable(
  "HEXCLAVE_FREESTYLE_SNAPSHOT_ID",
  "STACK_FREESTYLE_SNAPSHOT_ID",
)
  ?? DEFAULT_FREESTYLE_SNAPSHOT_ID;
const apiKey = readHexclaveEnvironmentVariable(
  "HEXCLAVE_FREESTYLE_API_KEY",
  "STACK_FREESTYLE_API_KEY",
) ?? readEnvironmentVariable("FREESTYLE_API_KEY");

function readEnvironmentVariable(name: string): string | undefined {
  // This bootstrap must run before Hexclave or its generated shared package is
  // built, so it deliberately cannot depend on the backend getEnvVariable helper.
  // eslint-disable-next-line no-restricted-syntax
  return process.env[name] || undefined;
}

function readHexclaveEnvironmentVariable(
  hexclaveName: string,
  stackName: string,
): string | undefined {
  const hexclaveValue = readEnvironmentVariable(hexclaveName);
  const stackValue = readEnvironmentVariable(stackName);
  if (hexclaveValue != null && stackValue != null && hexclaveValue !== stackValue) {
    throw new Error(`${hexclaveName} and ${stackName} are both set to different values`);
  }
  return hexclaveValue ?? stackValue;
}

if (!apiKey) {
  throw new Error("Set HEXCLAVE_FREESTYLE_API_KEY, STACK_FREESTYLE_API_KEY, or FREESTYLE_API_KEY before bootstrapping the snapshot.");
}

const freestyle = new Freestyle({ apiKey });
try {
  const existing = await freestyle.vms.snapshots.get(snapshotId);
  throw new Error(`Snapshot slug ${snapshotId} already belongs to ${existing.id}; choose a new HEXCLAVE_FREESTYLE_SNAPSHOT_ID or delete the old snapshot explicitly.`);
} catch (error) {
  if (!(error instanceof FreestyleApiError) || error.status !== 404) throw error;
}

const archiveResponse = await fetch(NODE_ARCHIVE_URL);
if (!archiveResponse.ok) {
  throw new Error(`Failed to download Node ${NODE_VERSION} (HTTP ${archiveResponse.status})`);
}
const archive = new Uint8Array(await archiveResponse.arrayBuffer());
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
if (archiveSha256 !== NODE_ARCHIVE_SHA256) {
  throw new Error(`Node archive checksum mismatch: expected ${NODE_ARCHIVE_SHA256}, received ${archiveSha256}`);
}

const [collectorScript, bootstrapScript] = await Promise.all([
  readFile(new URL("./freestyle-node-runtime-bundle.sh", import.meta.url), "utf8"),
  readFile(new URL("./freestyle-snapshot-bootstrap.sh", import.meta.url), "utf8"),
]);

const { vm: collectorVm } = await freestyle.vms.create({
  snapshotId: "freestyle/ubuntu-sm",
  ttlSeconds: 15 * 60,
  automaticRestart: false,
  metadata: {
    app: "hexclave",
    purpose: "javascript-runtime-collector",
  },
  firewall: { rules: [] },
});

let runtimeBundle: Uint8Array;
let runtimeBundleSha256: string;
try {
  await Promise.all([
    collectorVm.fs.writeFile("/tmp/hexclave-node-archive.tar.gz", archive),
    collectorVm.fs.writeTextFile(
      "/tmp/freestyle-node-runtime-bundle.sh",
      collectorScript,
      { mode: 0o700 },
    ),
  ]);
  // freestyle/ubuntu-sm runs exec as the unprivileged `ubuntu` user by default; the bundle
  // script needs root for /opt and chroot.
  const collection = await collectorVm.exec({
    command: "/tmp/freestyle-node-runtime-bundle.sh",
    linuxUser: "root",
    timeoutMs: 300_000,
  });
  if (collection.statusCode !== 0) {
    throw new Error(`Node runtime collection exited with status ${collection.statusCode}: ${collection.stderr ?? ""}`);
  }
  [runtimeBundle, runtimeBundleSha256] = await Promise.all([
    collectorVm.fs.readFile("/tmp/hexclave-node-runtime.tar.gz"),
    collectorVm.fs.readTextFile("/tmp/hexclave-node-runtime.sha256"),
  ]);
  runtimeBundleSha256 = runtimeBundleSha256.trim();
  const receivedBundleSha256 = createHash("sha256").update(runtimeBundle).digest("hex");
  if (receivedBundleSha256 !== runtimeBundleSha256) {
    throw new Error(`Node runtime bundle checksum mismatch: expected ${runtimeBundleSha256}, received ${receivedBundleSha256}`);
  }
} finally {
  await collectorVm.delete();
}

const { vm } = await freestyle.vms.create({
  snapshotId: "freestyle/busybox",
  ttlSeconds: 30 * 60,
  automaticRestart: false,
  metadata: {
    app: "hexclave",
    purpose: "javascript-snapshot-builder",
  },
  firewall: {
    rules: [{ action: "allow", source: {}, destination: { public: true } }],
  },
});

try {
  await vm.resize({ memory: 1024, storage: 2048 });
  await Promise.all([
    vm.fs.writeFile("/opt/hexclave-node-runtime.tar.gz", runtimeBundle),
    vm.fs.writeTextFile("/opt/hexclave-node-runtime.sha256", `${runtimeBundleSha256}\n`),
    vm.fs.writeTextFile(
      "/tmp/freestyle-snapshot-bootstrap.sh",
      bootstrapScript,
      { mode: 0o700 },
    ),
  ]);
  const bootstrap = await vm.exec({
    command: "/tmp/freestyle-snapshot-bootstrap.sh",
    timeoutMs: 300_000,
  });
  if (bootstrap.statusCode !== 0) {
    throw new Error(`Snapshot bootstrap exited with status ${bootstrap.statusCode}: ${bootstrap.stderr ?? ""}`);
  }

  const verificationId = "00000000-0000-4000-8000-000000000000";
  const verificationHostDirectory = `/opt/hexclave-runtime/work/${verificationId}`;
  await vm.fs.mkdir(verificationHostDirectory);
  await Promise.all([
    vm.fs.writeTextFile(
      `${verificationHostDirectory}/package.json`,
      JSON.stringify({ private: true, type: "module", dependencies: {} }) + "\n",
    ),
    vm.fs.writeTextFile(
      `${verificationHostDirectory}/runner.mjs`,
      `import { writeFile } from "node:fs/promises";\nawait writeFile("./verified", process.version);\n`,
    ),
  ]);
  const verification = await vm.exec({
    command: `/usr/local/bin/hexclave-run-job ${verificationHostDirectory}`,
    timeoutMs: 300_000,
  });
  if (verification.statusCode !== 0) {
    throw new Error(`Snapshot verification exited with status ${verification.statusCode}: ${verification.stderr ?? ""}`);
  }
  const verifiedNodeVersion = await vm.fs.readTextFile(`${verificationHostDirectory}/verified`);
  if (!verifiedNodeVersion.startsWith("v24.")) {
    throw new Error(`Snapshot verification expected Node 24, received ${verifiedNodeVersion}`);
  }

  const { snapshot, snapshotId: createdSnapshotId } = await vm.snapshot({
    slug: snapshotId,
    displayName: "Hexclave BusyBox JavaScript sandbox (Node 24)",
  });
  process.stdout.write(`Created Freestyle snapshot ${snapshot.slug ?? createdSnapshotId} (${createdSnapshotId})\n`);
} finally {
  await vm.delete();
}
