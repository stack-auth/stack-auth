import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Freestyle, FreestyleApiError } from "freestyle";
import { DEFAULT_FREESTYLE_SNAPSHOT_ID } from "../src/lib/freestyle-vm-constants";

const ALPINE_MINIROOTFS_URL = "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-minirootfs-3.24.0-x86_64.tar.gz";
const ALPINE_MINIROOTFS_SHA256 = "de9a11c0e0e7e9c94db3ed8af7b450eafc0b13687bd7e9199d55050f20aa0a89";
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

const archiveResponse = await fetch(ALPINE_MINIROOTFS_URL);
if (!archiveResponse.ok) {
  throw new Error(`Failed to download Alpine minirootfs (HTTP ${archiveResponse.status})`);
}
const archive = new Uint8Array(await archiveResponse.arrayBuffer());
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
if (archiveSha256 !== ALPINE_MINIROOTFS_SHA256) {
  throw new Error(`Alpine minirootfs checksum mismatch: expected ${ALPINE_MINIROOTFS_SHA256}, received ${archiveSha256}`);
}

const bootstrapScript = await readFile(
  new URL("./freestyle-snapshot-bootstrap.sh", import.meta.url),
  "utf8",
);
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
    vm.fs.writeFile("/tmp/alpine-minirootfs.tar.gz", archive),
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
    command: `/usr/local/bin/hexclave-run-job /work/${verificationId}`,
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
    displayName: "Hexclave JavaScript sandbox (Node 24)",
  });
  process.stdout.write(`Created Freestyle snapshot ${snapshot.slug ?? createdSnapshotId} (${createdSnapshotId})\n`);
} finally {
  await vm.delete();
}
