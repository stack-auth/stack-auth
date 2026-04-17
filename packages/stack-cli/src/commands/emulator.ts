import { Command } from "commander";
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { CliError } from "../lib/errors.js";

const DEFAULT_EMULATOR_BACKEND_PORT = 26701;

function emulatorBackendPort(): number {
  const raw = process.env.EMULATOR_BACKEND_PORT;
  if (!raw) return DEFAULT_EMULATOR_BACKEND_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid EMULATOR_BACKEND_PORT: ${raw}`);
  }
  return parsed;
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
  let delay = 250;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      const contents = readFileSync(path, "utf-8").trim();
      if (contents) return contents;
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

function gh(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    if (err instanceof Error && "stderr" in err && typeof err.stderr === "string") {
      throw new CliError(`GitHub CLI error: ${err.stderr}`);
    }
    throw new CliError("GitHub CLI (gh) is required. Install: https://cli.github.com/");
  }
}

function emulatorScriptsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, "emulator");
  if (existsSync(join(bundled, "run-emulator.sh"))) return bundled;
  const repo = resolve(here, "../../../docker/local-emulator/qemu");
  if (existsSync(join(repo, "run-emulator.sh"))) return repo;
  throw new CliError("Emulator scripts not found in CLI bundle.");
}

function emulatorSpawnEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    EMULATOR_RUN_DIR: emulatorRunDir(),
    EMULATOR_IMAGE_DIR: emulatorImageDir(),
    ...extra,
  };
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
  mkdirSync(emulatorImageDir(), { recursive: true });
  const img = join(emulatorImageDir(), `stack-emulator-${arch}.qcow2`);
  if (!existsSync(img)) {
    console.log("No emulator image found. Pulling latest...");
    pullRelease(arch);
  }
  await runEmulator("start", { EMULATOR_ARCH: arch });
}

function resolveArch(raw?: string): "arm64" | "amd64" {
  const arch = raw ?? (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : null);
  if (arch === "arm64" || arch === "amd64") return arch;
  throw new CliError(`Invalid architecture: ${raw ?? process.arch}. Expected arm64 or amd64.`);
}

function pullRelease(arch: "arm64" | "amd64", opts: { repo?: string; branch?: string; tag?: string } = {}) {
  const repo = opts.repo ?? "stack-auth/stack-auth";
  const branch = opts.branch ?? "dev";
  const tag = opts.tag ?? `emulator-${branch}-latest`;
  const asset = `stack-emulator-${arch}.qcow2`;
  const imageDir = emulatorImageDir();
  mkdirSync(imageDir, { recursive: true });
  const dest = join(imageDir, asset);
  const tmpDest = `${dest}.download`;

  console.log(`Pulling ${asset} from release ${tag}...`);
  try {
    execFileSync("gh", ["release", "download", tag, "--repo", repo, "--pattern", asset, "--output", tmpDest, "--clobber"], { stdio: "inherit" });
  } catch (err) {
    if (existsSync(tmpDest)) unlinkSync(tmpDest);
    throw new CliError(`Failed to download ${asset} from release ${tag}: ${err instanceof Error ? err.message : err}\nRun 'stack emulator list-releases' to see available releases.`);
  }
  renameSync(tmpDest, dest);
  console.log(`Downloaded: ${dest}`);
}

export function registerEmulatorCommand(program: Command) {
  const emulator = program.command("emulator").description("Manage the QEMU local emulator");

  emulator
    .command("pull")
    .description("Download an emulator image from GitHub Releases or a PR build")
    .option("--arch <arch>", "Target architecture (default: current system arch)")
    .option("--branch <branch>", "Release branch (default: dev)")
    .option("--tag <tag>", "Specific release tag (default: latest)")
    .option("--repo <repo>", "GitHub repository (default: stack-auth/stack-auth)")
    .option("--pr <number>", "Pull from a PR's CI artifacts")
    .option("--run <id>", "Pull from a specific workflow run's artifacts")
    .action(async (opts) => {
      const arch = resolveArch(opts.arch);
      const repo = opts.repo ?? "stack-auth/stack-auth";

      if (opts.run || opts.pr) {
        let runId = opts.run as string | undefined;
        if (!runId) {
          console.log(`Finding latest successful build for PR #${opts.pr}...`);
          const { headRefName } = JSON.parse(gh(["pr", "view", opts.pr, "--repo", repo, "--json", "headRefName"]));
          const runs = JSON.parse(gh(["run", "list", "--repo", repo, "--workflow", "qemu-emulator-build.yaml", "--branch", headRefName, "--status", "success", "--limit", "1", "--json", "databaseId"]));
          if (runs.length === 0) throw new CliError(`No successful build found for PR #${opts.pr} (branch: ${headRefName}).`);
          runId = String(runs[0].databaseId);
        }

        const imageDir = emulatorImageDir();
        mkdirSync(imageDir, { recursive: true });
        const dest = join(imageDir, `stack-emulator-${arch}.qcow2`);
        if (existsSync(dest)) unlinkSync(dest);
        console.log(`Downloading qemu-emulator-${arch} from workflow run ${runId}...`);
        try {
          execFileSync("gh", ["run", "download", runId, "--repo", repo, "--name", `qemu-emulator-${arch}`, "--dir", imageDir], { stdio: "inherit" });
        } catch (err) {
          throw new CliError(`Failed to download artifact from run ${runId}: ${err instanceof Error ? err.message : err}`);
        }
        if (!existsSync(dest)) throw new CliError(`Expected image not found at ${dest} after download.`);
        console.log(`Downloaded: ${dest}`);
      } else {
        pullRelease(arch, { repo, branch: opts.branch, tag: opts.tag });
      }
    });

  emulator
    .command("start")
    .description("Start the emulator in the background (auto-pulls the latest image if none exists)")
    .option("--arch <arch>", "Target architecture (default: current system arch). Non-native uses software emulation and is significantly slower.")
    .option("--config-file <path>", "Path to a config file; when set, credentials for this project are printed to stdout as JSON")
    .action(async (opts: { arch?: string, configFile?: string }) => {
      const arch = resolveArch(opts.arch);

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
        childEnv.STACK_PUBLISHABLE_CLIENT_KEY = creds.publishable_client_key;
        childEnv.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY = creds.publishable_client_key;
        childEnv.STACK_SECRET_SERVER_KEY = creds.secret_server_key;
        childEnv.STACK_API_URL = apiUrl;
        childEnv.NEXT_PUBLIC_STACK_API_URL = apiUrl;
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
          runEmulator("stop")
            .catch(() => { /* best-effort stop */ })
            .finally(() => process.exit(exitCode));
        }
      });
    });

  emulator.command("stop").description("Stop the emulator (data preserved; use 'reset' to clear)").action(() => runEmulator("stop"));
  emulator.command("reset").description("Reset emulator state for a fresh boot").action(() => runEmulator("reset"));
  emulator.command("status").description("Show emulator and service health").action(() => runEmulator("status"));

  emulator
    .command("list-releases")
    .description("List available emulator releases")
    .option("--repo <repo>", "GitHub repository (default: stack-auth/stack-auth)")
    .action((opts) => {
      const repo = opts.repo ?? "stack-auth/stack-auth";
      console.log(`Available emulator releases from ${repo}:\n`);
      const lines = gh(["release", "list", "--repo", repo, "--limit", "20"]).split("\n").filter((l) => l.toLowerCase().includes("emulator"));
      if (lines.length === 0) console.log("No emulator releases found.");
      else for (const line of lines) console.log(line);
    });
}
