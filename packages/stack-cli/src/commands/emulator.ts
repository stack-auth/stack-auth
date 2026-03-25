import { Command } from "commander";
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { CliError } from "../lib/errors.js";

const DEFAULT_REPO = "stack-auth/stack-auth";
const DEFAULT_BRANCH = "dev";
const EMULATOR_ARCHES = ["arm64", "amd64"] as const;

type EmulatorArch = typeof EMULATOR_ARCHES[number];
type BuildTargetArch = EmulatorArch | "both";

function detectArch(): EmulatorArch {
  switch (process.arch) {
    case "arm64": {
      return "arm64";
    }
    case "x64": {
      return "amd64";
    }
    default: {
      throw new CliError(`Unsupported architecture: ${process.arch}`);
    }
  }
}

function findQemuDir(): string {
  const candidates = [
    resolve(process.cwd(), "docker/local-emulator/qemu"),
    resolve(process.cwd(), "../docker/local-emulator/qemu"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "run-emulator.sh"))) {
      return candidate;
    }
  }

  throw new CliError(
    "Could not find QEMU emulator directory. Run this from the stack-auth repo root."
  );
}

function runCommand(cwd: string, command: string, args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      cwd,
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new CliError(`${command} exited with code ${code}`));
    });
    child.on("error", (err) => {
      reject(new CliError(`Failed to run ${command}: ${err.message}`));
    });
  });
}

function runScript(qemuDir: string, script: string, args: string[], env?: Record<string, string>): Promise<void> {
  return runCommand(qemuDir, join(qemuDir, script), args, env);
}

function runEmulatorAction(action: string, env?: Record<string, string>): Promise<void> {
  return runScript(findQemuDir(), "run-emulator.sh", [action], env);
}

function ghRelease(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    if (err instanceof Error && "stderr" in err && typeof err.stderr === "string") {
      throw new CliError(`GitHub CLI error: ${err.stderr}`);
    }
    throw new CliError("GitHub CLI (gh) is required. Install: https://cli.github.com/");
  }
}

function parseBuildArch(arch: string | undefined): BuildTargetArch {
  const resolvedArch = arch ?? detectArch();
  if (resolvedArch === "arm64" || resolvedArch === "amd64" || resolvedArch === "both") {
    return resolvedArch;
  }
  throw new CliError(`Unsupported build architecture: ${resolvedArch}. Use arm64, amd64, or both.`);
}

function isValidEmulatorArch(arch: string): arch is EmulatorArch {
  return arch === "arm64" || arch === "amd64";
}

function parseEmulatorArch(arch: string | undefined): EmulatorArch {
  const resolvedArch = arch ?? detectArch();
  if (isValidEmulatorArch(resolvedArch)) {
    return resolvedArch;
  }
  throw new CliError(`Invalid --arch: ${resolvedArch}; expected one of: ${EMULATOR_ARCHES.join(", ")}.`);
}

async function pullImage(arch: EmulatorArch, opts: { repo?: string; branch?: string; tag?: string } = {}) {
  const repo = opts.repo ?? DEFAULT_REPO;
  const branch = opts.branch ?? DEFAULT_BRANCH;
  const tag = opts.tag ?? `emulator-${branch}-latest`;
  const asset = `stack-emulator-${arch}.qcow2`;

  const qemuDir = findQemuDir();
  const imageDir = join(qemuDir, "images");
  mkdirSync(imageDir, { recursive: true });

  const dest = join(imageDir, asset);
  const tmpDest = `${dest}.download`;

  console.log(`Pulling image for ${arch} from release ${tag}...`);

  try {
    execFileSync("gh", [
      "release",
      "download",
      tag,
      "--repo",
      repo,
      "--pattern",
      asset,
      "--output",
      tmpDest,
      "--clobber",
    ], { stdio: "inherit" });
  } catch (err) {
    if (existsSync(tmpDest)) unlinkSync(tmpDest);
    const reason = err instanceof Error
      ? (err.stack ?? err.message)
      : String(err);
    throw new CliError(
      `Failed to download ${asset} from release ${tag}: ${reason}\nRun 'stack emulator list-releases' to see available releases.`
    );
  }

  renameSync(tmpDest, dest);
  console.log(`Downloaded: ${dest}`);
}

function isEmulatorRunning(): boolean {
  const qemuDir = findQemuDir();
  try {
    execFileSync(join(qemuDir, "run-emulator.sh"), ["status"], {
      stdio: "pipe",
      cwd: qemuDir,
    });
    return true;
  } catch {
    return false;
  }
}

async function startEmulator(arch: EmulatorArch) {
  const qemuDir = findQemuDir();
  const img = join(qemuDir, "images", `stack-emulator-${arch}.qcow2`);

  if (!existsSync(img)) {
    console.log("No emulator image found. Pulling latest...");
    await pullImage(arch);
  }

  await runScript(qemuDir, "run-emulator.sh", ["start"], { EMULATOR_ARCH: arch });
}

export function registerEmulatorCommand(program: Command) {
  const emulator = program
    .command("emulator")
    .description("Manage the QEMU local emulator");

  emulator
    .command("pull")
    .description("Download the latest emulator image from GitHub Releases")
    .option("--arch <arch>", "Target architecture (arm64 or amd64)")
    .option("--branch <branch>", `Release branch (default: ${DEFAULT_BRANCH})`)
    .option("--tag <tag>", "Specific release tag")
    .option("--repo <repo>", `GitHub repository (default: ${DEFAULT_REPO})`)
    .action(async (opts) => {
      const arch = parseEmulatorArch(opts.arch);
      await pullImage(arch, {
        repo: opts.repo,
        branch: opts.branch,
        tag: opts.tag,
      });
    });

  emulator
    .command("start")
    .description("Start the emulator (auto-pulls if no image exists)")
    .option("--arch <arch>", "Target architecture")
    .action(async (opts) => {
      const arch = parseEmulatorArch(opts.arch);
      await startEmulator(arch);
    });

  emulator
    .command("run")
    .description("Start the emulator, run a command, and stop the emulator when the command exits")
    .argument("<cmd>", "Command to run (e.g. \"npm run dev\")")
    .option("--arch <arch>", "Target architecture")
    .option("--config-file <path>", "Path to a config file (sets NEXT_PUBLIC_STACK_LOCAL_EMULATOR_CONFIG_FILE_PATH)")
    .action(async (cmd: string, opts: { arch?: string, configFile?: string }) => {
      const arch = parseEmulatorArch(opts.arch);

      if (opts.configFile) {
        const resolvedConfigFile = resolve(opts.configFile);
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
      if (opts.configFile) {
        childEnv.NEXT_PUBLIC_STACK_LOCAL_EMULATOR_CONFIG_FILE_PATH = resolve(opts.configFile);
      }

      const child = spawn(cmd, {
        shell: true,
        stdio: "inherit",
        env: childEnv,
      });

      const cleanup = async () => {
        if (!alreadyRunning) {
          console.log("\nStopping emulator...");
          try {
            await runEmulatorAction("stop");
          } catch {
            // best-effort stop
          }
        }
      };

      child.on("close", (code) => {
        cleanup().then(() => {
          process.exit(code ?? 1);
        }).catch(() => {
          process.exit(code ?? 1);
        });
      });

      process.on("SIGINT", () => {
        child.kill("SIGINT");
      });
      process.on("SIGTERM", () => {
        child.kill("SIGTERM");
      });
    });

  emulator
    .command("stop")
    .description("Stop the emulator")
    .action(() => runEmulatorAction("stop"));

  emulator
    .command("reset")
    .description("Reset emulator state for a fresh boot")
    .action(() => runEmulatorAction("reset"));

  emulator
    .command("status")
    .description("Show emulator and service health")
    .action(() => runEmulatorAction("status"));

  emulator
    .command("build")
    .description("Build the QEMU emulator image locally")
    .option("--arch <arch>", "Target architecture (arm64, amd64, or both)")
    .action(async (opts) => {
      const arch = parseBuildArch(opts.arch);
      await runScript(findQemuDir(), "build-image.sh", [arch]);
    });

  emulator
    .command("list-releases")
    .description("List available emulator releases")
    .option("--repo <repo>", `GitHub repository (default: ${DEFAULT_REPO})`)
    .action(async (opts) => {
      const repo = opts.repo || DEFAULT_REPO;
      console.log(`Available emulator releases from ${repo}:\n`);
      const output = ghRelease(["release", "list", "--repo", repo, "--limit", "20"]);
      const lines = output.split("\n").filter((l) => l.toLowerCase().includes("emulator"));
      if (lines.length === 0) {
        console.log("No emulator releases found.");
      } else {
        for (const line of lines) {
          console.log(line);
        }
      }
    });
}
