import { Command } from "commander";
import { execFileSync, spawn } from "child_process";
import extract from "extract-zip";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { CliError } from "../lib/errors.js";
import { writeIso } from "../lib/iso.js";

const DEFAULT_EMULATOR_BACKEND_PORT = 26701;
const DEFAULT_EMULATOR_DASHBOARD_PORT = 26700;
const DEFAULT_EMULATOR_MINIO_PORT = 26702;
const DEFAULT_EMULATOR_INBUCKET_PORT = 26703;
const DEFAULT_PORT_PREFIX = "81";
const GITHUB_API = "https://api.github.com";
const DEFAULT_REPO = "stack-auth/stack-auth";
const AARCH64_FIRMWARE_PATHS = [
  "/opt/homebrew/share/qemu/edk2-aarch64-code.fd",
  "/usr/share/qemu/edk2-aarch64-code.fd",
  "/usr/share/AAVMF/AAVMF_CODE.fd",
  "/usr/share/qemu-efi-aarch64/QEMU_EFI.fd",
];

export function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

function emulatorBackendPort(): number {
  return envPort("EMULATOR_BACKEND_PORT", DEFAULT_EMULATOR_BACKEND_PORT);
}

function emulatorHome(): string {
  return process.env.STACK_EMULATOR_HOME ?? join(homedir(), ".stack", "emulator");
}

function emulatorRunDir(): string {
  return join(emulatorHome(), "run");
}

function emulatorImageDir(): string {
  return join(emulatorHome(), "images");
}

function internalPckPath(): string {
  return join(emulatorRunDir(), "vm", "internal-pck");
}

async function readInternalPck(timeoutMs = 60_000): Promise<string> {
  const path = internalPckPath();
  const deadline = Date.now() + timeoutMs;
  let delay = 50;
  while (Date.now() < deadline) {
    try {
      const contents = readFileSync(path, "utf-8").trim();
      if (contents) return contents;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 2000);
  }
  throw new CliError(`Timed out waiting for emulator internal publishable client key at ${path}`);
}

type EmulatorCredentials = {
  project_id: string,
  publishable_client_key: string,
  secret_server_key: string,
};

async function fetchEmulatorCredentials(pck: string, backendPort: number, configFile: string): Promise<EmulatorCredentials> {
  const url = `http://127.0.0.1:${backendPort}/api/v1/internal/local-emulator/project`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stack-Project-Id": "internal",
      "X-Stack-Access-Type": "client",
      "X-Stack-Publishable-Client-Key": pck,
    },
    body: JSON.stringify({ absolute_file_path: configFile }),
  });
  if (!res.ok) {
    throw new CliError(`Failed to initialize local emulator project (${res.status}): ${await res.text()}`);
  }
  const data = await res.json() as {
    project_id: string,
    publishable_client_key: string,
    secret_server_key: string,
  };
  return {
    project_id: data.project_id,
    publishable_client_key: data.publishable_client_key,
    secret_server_key: data.secret_server_key,
  };
}

// Resolve a GitHub auth token. We try GITHUB_TOKEN first so users can pin a
// PAT, then fall back to `gh auth token` if the gh CLI is installed and
// signed in. If neither works we return undefined — public release downloads
// still work (anonymous, lower rate limit) but artifact downloads fail with a
// clear error at the call site.
function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

async function ghApi<T>(path: string): Promise<T> {
  const token = githubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 || res.status === 403
      ? " (set GITHUB_TOKEN or run `gh auth login` for higher rate limits / private access)"
      : "";
    throw new CliError(`GitHub API ${res.status} ${res.statusText} for ${path}${hint}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return await (res.json() as Promise<T>);
}

function emulatorScriptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, "emulator");
  if (existsSync(join(bundled, "run-emulator.sh"))) return ensureExecutable(bundled);
  const repo = resolve(here, "../../../docker/local-emulator/qemu");
  if (existsSync(join(repo, "run-emulator.sh"))) return ensureExecutable(repo);
  throw new CliError("Emulator scripts not found in CLI bundle.");
}

// npm pack strips the execute bit from non-`bin` files, so restore it here.
function ensureExecutable(scriptsDir: string): string {
  try {
    chmodSync(join(scriptsDir, "run-emulator.sh"), 0o755);
  } catch {
    // best-effort
  }
  return scriptsDir;
}

function baseEnvPath(): string {
  // Lives one directory up from the scripts dir in both bundled and repo
  // layouts (dist/.env.development vs docker/local-emulator/.env.development).
  const path = resolve(emulatorScriptsDir(), "..", ".env.development");
  if (!existsSync(path)) {
    throw new CliError(`Emulator base.env not found at ${path}`);
  }
  return path;
}

function emulatorSpawnEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    EMULATOR_RUN_DIR: emulatorRunDir(),
    EMULATOR_IMAGE_DIR: emulatorImageDir(),
    ...extra,
  };
}

// Generate the runtime config ISO that the VM mounts via STACKCFG. Replaces
// the hdiutil/mkisofs/genisoimage host dep — see ../lib/iso.ts.
function prepareRuntimeConfigIso(): void {
  const vmDir = join(emulatorRunDir(), "vm");
  mkdirSync(vmDir, { recursive: true });
  const portPrefix = process.env.PORT_PREFIX ?? process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? DEFAULT_PORT_PREFIX;
  const dashboardPort = envPort("EMULATOR_DASHBOARD_PORT", DEFAULT_EMULATOR_DASHBOARD_PORT);
  const backendPort = envPort("EMULATOR_BACKEND_PORT", DEFAULT_EMULATOR_BACKEND_PORT);
  const minioPort = envPort("EMULATOR_MINIO_PORT", DEFAULT_EMULATOR_MINIO_PORT);
  const inbucketPort = envPort("EMULATOR_INBUCKET_PORT", DEFAULT_EMULATOR_INBUCKET_PORT);

  const runtimeEnv = [
    `STACK_EMULATOR_PORT_PREFIX=${portPrefix}`,
    `STACK_EMULATOR_DASHBOARD_HOST_PORT=${dashboardPort}`,
    `STACK_EMULATOR_BACKEND_HOST_PORT=${backendPort}`,
    `STACK_EMULATOR_MINIO_HOST_PORT=${minioPort}`,
    `STACK_EMULATOR_INBUCKET_HOST_PORT=${inbucketPort}`,
    `STACK_EMULATOR_VM_DIR_HOST=${vmDir}`,
    "",
  ].join("\n");
  const baseEnv = readFileSync(baseEnvPath());
  writeIso(join(vmDir, "runtime-config.iso"), "STACKCFG", [
    { name: "runtime.env", data: Buffer.from(runtimeEnv, "utf-8") },
    { name: "base.env", data: baseEnv },
  ]);
}

function runEmulator(action: string, env?: Record<string, string>): Promise<void> {
  const scriptsDir = emulatorScriptsDir();
  mkdirSync(emulatorRunDir(), { recursive: true });
  mkdirSync(emulatorImageDir(), { recursive: true });
  return new Promise((resolvePromise, reject) => {
    const child = spawn(join(scriptsDir, "run-emulator.sh"), [action], {
      stdio: "inherit",
      env: emulatorSpawnEnv(env),
      cwd: scriptsDir,
    });
    child.on("close", (code) => code === 0 ? resolvePromise() : reject(new CliError(`run-emulator.sh ${action} exited with code ${code}`)));
    child.on("error", (err) => reject(new CliError(`Failed to run run-emulator.sh: ${err.message}`)));
  });
}

function isEmulatorRunning(): boolean {
  const scriptsDir = emulatorScriptsDir();
  try {
    execFileSync(join(scriptsDir, "run-emulator.sh"), ["status"], {
      stdio: "pipe",
      cwd: scriptsDir,
      env: emulatorSpawnEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

async function startEmulator(arch: "arm64" | "amd64"): Promise<void> {
  const img = join(emulatorImageDir(), `stack-emulator-${arch}.qcow2`);
  if (!existsSync(img)) {
    console.log("No emulator image found. Pulling latest...");
    await pullRelease(arch);
    // Capture now so this and all subsequent starts resume fast. Skipping it
    // would cold-boot today plus every future start (we never auto-capture).
    await captureLocalSnapshot(arch);
  }
  prepareRuntimeConfigIso();
  // Signal to run-emulator.sh that runtime-config.iso was written by the CLI
  // via lib/iso.ts; the shell's ensure_runtime_config_iso should trust it and
  // skip its own regeneration (which would otherwise require the
  // hdiutil/mkisofs/genisoimage host dep the TS writer replaces).
  await runEmulator("start", { EMULATOR_ARCH: arch, STACK_EMULATOR_CLI_WROTE_ISO: "1" });
}

export function resolveArch(raw?: string): "arm64" | "amd64" {
  const arch = raw ?? (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null);
  if (arch === "arm64" || arch === "amd64") return arch;
  throw new CliError(`Invalid architecture: ${raw ?? process.arch}. Expected arm64 or amd64.`);
}

type ReleaseAsset = { name: string, url: string, size: number };
type ReleaseResponse = { assets: ReleaseAsset[] };

async function pullRelease(arch: "arm64" | "amd64", opts: { repo?: string, branch?: string, tag?: string } = {}) {
  const repo = opts.repo ?? DEFAULT_REPO;
  const branch = opts.branch ?? "dev";
  const tag = opts.tag ?? `emulator-${branch}-latest`;
  const imageDir = emulatorImageDir();
  mkdirSync(imageDir, { recursive: true });

  const diskAsset = `stack-emulator-${arch}.qcow2`;

  const release = await ghApi<ReleaseResponse>(`/repos/${repo}/releases/tags/${tag}`);
  const diskMatch = release.assets.find((a) => a.name === diskAsset);
  if (!diskMatch) {
    throw new CliError(`Asset ${diskAsset} not found in release ${tag}. Run 'stack emulator list-releases' to see available releases.`);
  }
  const token = githubToken();
  await downloadReleaseAsset(diskMatch, imageDir, diskAsset, token, tag);
}

// Cold-boot the VM, wait for services, capture a snapshot via QMP, compress,
// stop. Runs once per qcow2 download so subsequent `stack emulator start`s
// resume in ~3-8s. Snapshots are always captured on the user's own machine
// because QEMU migration state isn't portable across accelerators
// (KVM/HVF/TCG) or `-cpu max` feature sets.
async function captureLocalSnapshot(arch: "arm64" | "amd64"): Promise<void> {
  preflightForVmStart("pull", arch);
  prepareRuntimeConfigIso();
  console.log("Capturing local snapshot (first-time, ~1-3 min cold boot + capture)...");
  await runEmulator("capture", { EMULATOR_ARCH: arch });
}

async function downloadReleaseAsset(
  match: ReleaseAsset,
  imageDir: string,
  asset: string,
  token: string | undefined,
  tag: string,
): Promise<void> {
  const dest = join(imageDir, asset);
  const tmpDest = `${dest}.download`;
  console.log(`Pulling ${asset} from release ${tag}...`);
  const headers: Record<string, string> = { Accept: "application/octet-stream" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    await downloadWithProgress(match.url, headers, tmpDest, match.size);
  } catch (err) {
    if (existsSync(tmpDest)) unlinkSync(tmpDest);
    if (err instanceof CliError) throw err;
    throw new CliError(`Failed to download ${asset} from release ${tag}: ${err instanceof Error ? err.message : err}`);
  }
  renameSync(tmpDest, dest);
  console.log(`Downloaded: ${dest}`);
}

async function downloadWithProgress(url: string, headers: Record<string, string>, dest: string, totalBytes?: number): Promise<void> {
  const res = await fetch(url, { headers, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new CliError(`Download failed (${res.status} ${res.statusText}): ${url}`);
  }
  const total = totalBytes ?? (Number(res.headers.get("content-length")) || 0);
  const isTty = Boolean(process.stderr.isTTY);
  const startedAt = Date.now();
  let downloaded = 0;
  let lastRender = 0;

  const render = (final: boolean) => {
    const now = Date.now();
    if (!final && now - lastRender < 100) return;
    lastRender = now;
    const elapsed = Math.max(0.001, (now - startedAt) / 1000);
    const speed = downloaded / elapsed;
    const line = renderProgressLine(downloaded, total, speed);
    if (isTty) {
      process.stderr.write(`\r\x1b[2K${line}`);
    } else if (final) {
      process.stderr.write(`${line}\n`);
    }
  };

  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    downloaded += chunk.byteLength;
    render(false);
  });
  await pipeline(body, createWriteStream(dest));
  render(true);
  if (isTty) process.stderr.write("\n");
}

export function renderProgressLine(downloaded: number, total: number, bytesPerSec: number): string {
  const barWidth = 30;
  const pct = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0;
  const filled = total > 0 ? Math.round((downloaded / total) * barWidth) : 0;
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
  const pctStr = total > 0 ? `${pct.toFixed(1).padStart(5)}%` : "  ?  ";
  const sizeStr = total > 0 ? `${formatBytes(downloaded)}/${formatBytes(total)}` : formatBytes(downloaded);
  const speedStr = `${formatBytes(bytesPerSec)}/s`;
  const etaStr = total > 0 && bytesPerSec > 0 ? `  eta ${formatDuration((total - downloaded) / bytesPerSec)}` : "";
  return `  [${bar}] ${pctStr}  ${sizeStr}  ${speedStr}${etaStr}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "?";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${rm.toString().padStart(2, "0")}m`;
}

// --- Dependency preflight ---------------------------------------------------

type BinarySpec = { name: string, install: string };

function commandExists(bin: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function platformInstallHint(linuxPkg: string, macPkg: string): string {
  switch (process.platform) {
    case "darwin": {
      return `brew install ${macPkg}`;
    }
    case "linux": {
      return `apt install ${linuxPkg} (or your distro's equivalent)`;
    }
    default: {
      return `install ${macPkg}`;
    }
  }
}

function bin(name: string, linuxPkg: string, macPkg: string): BinarySpec {
  return { name, install: platformInstallHint(linuxPkg, macPkg) };
}

function requireBinaries(commandName: string, bins: BinarySpec[]): void {
  const missing = bins.filter((b) => !commandExists(b.name));
  if (missing.length === 0) return;
  const lines = missing.map((b) => `  - ${b.name}  →  ${b.install}`);
  throw new CliError(
    `\`stack emulator ${commandName}\` requires the following missing binaries:\n${lines.join("\n")}`,
  );
}

function warnIfMissing(commandName: string, bins: BinarySpec[]): void {
  const missing = bins.filter((b) => !commandExists(b.name));
  if (missing.length === 0) return;
  for (const b of missing) {
    console.warn(`[stack emulator ${commandName}] optional dep '${b.name}' missing — feature degraded. Install: ${b.install}`);
  }
}

function aarch64FirmwareAvailable(): boolean {
  return AARCH64_FIRMWARE_PATHS.some((p) => existsSync(p));
}

function commonVmBins(): BinarySpec[] {
  return [
    bin("qemu-img", "qemu-utils", "qemu"),
    bin("socat", "socat", "socat"),
    bin("curl", "curl", "curl"),
    bin("nc", "ncat", "netcat"),
    bin("lsof", "lsof", "lsof"),
    bin("openssl", "openssl", "openssl"),
  ];
}

function archSpecificQemuBin(arch: "arm64" | "amd64"): BinarySpec {
  if (arch === "arm64") {
    return bin("qemu-system-aarch64", "qemu-system-arm", "qemu");
  }
  return bin("qemu-system-x86_64", "qemu-system-x86", "qemu");
}

function preflightForVmStart(commandName: string, arch: "arm64" | "amd64"): void {
  requireBinaries(commandName, [archSpecificQemuBin(arch), ...commonVmBins()]);
  warnIfMissing(commandName, [bin("zstd", "zstd", "zstd")]);
  if (arch === "arm64" && !aarch64FirmwareAvailable()) {
    throw new CliError(
      `aarch64 UEFI firmware not found. Looked in:\n${AARCH64_FIRMWARE_PATHS.map((p) => `  - ${p}`).join("\n")}\n` +
      `Install: ${platformInstallHint("qemu-efi-aarch64", "qemu")}`,
    );
  }
}

// --- Workflow run / artifact downloads (replaces `gh run download`) ---------

type WorkflowRunsResponse = { workflow_runs: { id: number }[] };
type ArtifactsResponse = { artifacts: { id: number, name: string, size_in_bytes: number }[] };
type PullResponse = { head: { ref: string } };

async function downloadArtifactByName(repo: string, runId: string, name: string, destDir: string): Promise<boolean> {
  const token = githubToken();
  if (!token) {
    throw new CliError(
      "Downloading workflow run artifacts requires authentication. Set GITHUB_TOKEN or run `gh auth login`.",
    );
  }
  const list = await ghApi<ArtifactsResponse>(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  const match = list.artifacts.find((a) => a.name === name);
  if (!match) return false;
  const zipPath = join(destDir, `${name}.zip`);
  console.log(`Downloading artifact '${name}' from run ${runId}...`);
  await downloadWithProgress(
    `${GITHUB_API}/repos/${repo}/actions/artifacts/${match.id}/zip`,
    { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
    zipPath,
    match.size_in_bytes,
  );
  await extract(zipPath, { dir: destDir });
  unlinkSync(zipPath);
  return true;
}

export function registerEmulatorCommand(program: Command) {
  const emulator = program.command("emulator").description("Manage the QEMU local emulator");

  emulator
    .command("pull")
    .description("Download an emulator image from GitHub Releases or a PR build, then capture a local fast-start snapshot")
    .option("--arch <arch>", "Target architecture (default: current system arch)")
    .option("--branch <branch>", "Release branch (default: dev)")
    .option("--tag <tag>", "Specific release tag (default: latest)")
    .option("--repo <repo>", "GitHub repository (default: stack-auth/stack-auth)")
    .option("--pr <number>", "Pull from a PR's CI artifacts")
    .option("--run <id>", "Pull from a specific workflow run's artifacts")
    .option("--skip-snapshot", "Download only the qcow2; skip the one-time local snapshot capture")
    .action(async (opts: { arch?: string, repo?: string, branch?: string, tag?: string, pr?: string, run?: string, skipSnapshot?: boolean }) => {
      const arch = resolveArch(opts.arch);
      const repo = opts.repo ?? DEFAULT_REPO;

      if (opts.run || opts.pr) {
        let runId = opts.run;
        if (!runId) {
          console.log(`Finding latest successful build for PR #${opts.pr}...`);
          const pr = await ghApi<PullResponse>(`/repos/${repo}/pulls/${opts.pr}`);
          const headRefName = pr.head.ref;
          const runs = await ghApi<WorkflowRunsResponse>(
            `/repos/${repo}/actions/workflows/qemu-emulator-build.yaml/runs?branch=${encodeURIComponent(headRefName)}&status=success&per_page=1`,
          );
          if (runs.workflow_runs.length === 0) {
            throw new CliError(`No successful build found for PR #${opts.pr} (branch: ${headRefName}).`);
          }
          runId = String(runs.workflow_runs[0].id);
        }

        const imageDir = emulatorImageDir();
        mkdirSync(imageDir, { recursive: true });
        const dest = join(imageDir, `stack-emulator-${arch}.qcow2`);
        const snapshotDest = join(imageDir, `stack-emulator-${arch}.savevm.zst`);
        const snapshotRawDest = join(imageDir, `stack-emulator-${arch}.savevm.raw`);
        if (existsSync(dest)) unlinkSync(dest);
        // Stale snapshots from a previous pull would resume against the new
        // qcow2 and crash; wipe them so capture rebuilds cleanly.
        if (existsSync(snapshotDest)) unlinkSync(snapshotDest);
        if (existsSync(snapshotRawDest)) unlinkSync(snapshotRawDest);
        const downloaded = await downloadArtifactByName(repo, runId, `qemu-emulator-${arch}`, imageDir);
        if (!downloaded) {
          throw new CliError(`Artifact qemu-emulator-${arch} not found in workflow run ${runId}.`);
        }
        if (!existsSync(dest)) throw new CliError(`Expected image not found at ${dest} after download.`);
        console.log(`Downloaded: ${dest}`);
      } else {
        // Same stale-snapshot concern as the PR branch above.
        const imageDir = emulatorImageDir();
        const snapshotDest = join(imageDir, `stack-emulator-${arch}.savevm.zst`);
        const snapshotRawDest = join(imageDir, `stack-emulator-${arch}.savevm.raw`);
        if (existsSync(snapshotDest)) unlinkSync(snapshotDest);
        if (existsSync(snapshotRawDest)) unlinkSync(snapshotRawDest);
        await pullRelease(arch, { repo, branch: opts.branch, tag: opts.tag });
      }

      if (opts.skipSnapshot) {
        console.log("--skip-snapshot: not capturing a local snapshot. First `stack emulator start` will cold-boot.");
      } else {
        await captureLocalSnapshot(arch);
      }
    });

  emulator
    .command("start")
    .description("Start the emulator in the background (auto-pulls the latest image if none exists)")
    .option("--arch <arch>", "Target architecture (default: current system arch). Non-native uses software emulation and is significantly slower.")
    .option("--config-file <path>", "Path to a config file; when set, credentials for this project are printed to stdout as JSON")
    .action(async (opts: { arch?: string, configFile?: string }) => {
      const arch = resolveArch(opts.arch);
      preflightForVmStart("start", arch);

      let resolvedConfigFile: string | undefined;
      if (opts.configFile) {
        resolvedConfigFile = resolve(opts.configFile);
        if (!existsSync(resolvedConfigFile)) {
          throw new CliError(`Config file not found: ${resolvedConfigFile}`);
        }
      }

      if (isEmulatorRunning()) {
        console.warn("Emulator already running, reusing existing instance.");
      } else {
        await startEmulator(arch);
      }

      if (resolvedConfigFile) {
        const pck = await readInternalPck();
        const creds = await fetchEmulatorCredentials(pck, emulatorBackendPort(), resolvedConfigFile);
        console.log(JSON.stringify(creds, null, 2));
      }
    });

  emulator
    .command("run")
    .description("Start the emulator, run a command, and stop the emulator when the command exits")
    .argument("<cmd>", "Command to run (e.g. \"npm run dev\")")
    .option("--arch <arch>", "Target architecture")
    .option("--config-file <path>", "Path to a config file; fetches credentials and injects STACK_PROJECT_ID / STACK_PUBLISHABLE_CLIENT_KEY / STACK_SECRET_SERVER_KEY into the child")
    .action(async (cmd: string, opts: { arch?: string, configFile?: string }) => {
      const arch = resolveArch(opts.arch);
      preflightForVmStart("run", arch);

      let resolvedConfigFile: string | undefined;
      if (opts.configFile) {
        resolvedConfigFile = resolve(opts.configFile);
        if (!existsSync(resolvedConfigFile)) {
          throw new CliError(`Config file not found: ${resolvedConfigFile}`);
        }
      }

      const alreadyRunning = isEmulatorRunning();
      if (alreadyRunning) {
        console.log("Emulator already running, reusing existing instance.");
      } else {
        await startEmulator(arch);
      }

      const childEnv: Record<string, string> = { ...process.env as Record<string, string> };
      if (resolvedConfigFile) {
        const pck = await readInternalPck();
        const backendPort = emulatorBackendPort();
        const creds = await fetchEmulatorCredentials(pck, backendPort, resolvedConfigFile);
        const apiUrl = `http://127.0.0.1:${backendPort}`;
        childEnv.STACK_PROJECT_ID = creds.project_id;
        childEnv.NEXT_PUBLIC_STACK_PROJECT_ID = creds.project_id;
        childEnv.VITE_STACK_PROJECT_ID = creds.project_id;
        childEnv.EXPO_PUBLIC_STACK_PROJECT_ID = creds.project_id;
        childEnv.STACK_PUBLISHABLE_CLIENT_KEY = creds.publishable_client_key;
        childEnv.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY = creds.publishable_client_key;
        childEnv.VITE_STACK_PUBLISHABLE_CLIENT_KEY = creds.publishable_client_key;
        childEnv.EXPO_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY = creds.publishable_client_key;
        childEnv.STACK_SECRET_SERVER_KEY = creds.secret_server_key;
        childEnv.STACK_API_URL = apiUrl;
        childEnv.NEXT_PUBLIC_STACK_API_URL = apiUrl;
        childEnv.VITE_STACK_API_URL = apiUrl;
        childEnv.EXPO_PUBLIC_STACK_API_URL = apiUrl;
      }

      const child = spawn(cmd, { shell: true, stdio: "inherit", env: childEnv });

      const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
      const onSigint = forward("SIGINT");
      const onSigterm = forward("SIGTERM");
      process.on("SIGINT", onSigint);
      process.on("SIGTERM", onSigterm);

      child.on("close", (code) => {
        process.off("SIGINT", onSigint);
        process.off("SIGTERM", onSigterm);
        const exitCode = code ?? 1;
        if (alreadyRunning) {
          process.exit(exitCode);
        } else {
          console.log("\nStopping emulator...");
          const warnStopFailed = (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`Failed to stop emulator cleanly: ${msg}\n`);
          };
          runEmulator("stop")
            .catch(warnStopFailed)
            .finally(() => process.exit(exitCode));
        }
      });
    });

  emulator
    .command("stop")
    .description("Stop the emulator (data preserved; use 'reset' to clear)")
    .action(() => {
      requireBinaries("stop", [bin("socat", "socat", "socat")]);
      return runEmulator("stop");
    });

  emulator
    .command("reset")
    .description("Reset emulator state for a fresh boot")
    .action(() => {
      requireBinaries("reset", [bin("socat", "socat", "socat")]);
      return runEmulator("reset");
    });

  emulator
    .command("status")
    .description("Show emulator and service health")
    .action(() => {
      requireBinaries("status", [
        bin("curl", "curl", "curl"),
        bin("nc", "ncat", "netcat"),
      ]);
      return runEmulator("status");
    });

  emulator
    .command("list-releases")
    .description("List available emulator releases")
    .option("--repo <repo>", "GitHub repository (default: stack-auth/stack-auth)")
    .action(async (opts) => {
      const repo = opts.repo ?? DEFAULT_REPO;
      console.log(`Available emulator releases from ${repo}:\n`);
      type Release = { tag_name: string, name: string | null, published_at: string | null, draft: boolean, prerelease: boolean };
      const releases = await ghApi<Release[]>(`/repos/${repo}/releases?per_page=50`);
      const lines = releases
        .filter((r) => (r.tag_name + " " + (r.name ?? "")).toLowerCase().includes("emulator"))
        .slice(0, 20)
        .map((r) => {
          const status = r.draft ? "Draft" : r.prerelease ? "Pre-release" : "Latest";
          const date = r.published_at ? r.published_at.slice(0, 10) : "";
          return `${r.tag_name}\t${status}\t${date}`;
        });
      if (lines.length === 0) console.log("No emulator releases found.");
      else for (const line of lines) console.log(line);
    });
}
