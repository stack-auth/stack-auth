import { Command } from "commander";
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { CliError } from "../lib/errors.js";

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

function findQemuDir(): string {
  for (const rel of ["docker/local-emulator/qemu", "../docker/local-emulator/qemu"]) {
    const dir = resolve(process.cwd(), rel);
    if (existsSync(join(dir, "run-emulator.sh"))) return dir;
  }
  throw new CliError("Could not find QEMU emulator directory. Run this from the stack-auth repo root.");
}

function runEmulator(action: string, env?: Record<string, string>): Promise<void> {
  const qemuDir = findQemuDir();
  return new Promise((resolve, reject) => {
    const child = spawn(join(qemuDir, "run-emulator.sh"), [action], {
      stdio: "inherit",
      env: { ...process.env, ...env },
      cwd: qemuDir,
    });
    child.on("close", (code) => code === 0 ? resolve() : reject(new CliError(`run-emulator.sh ${action} exited with code ${code}`)));
    child.on("error", (err) => reject(new CliError(`Failed to run run-emulator.sh: ${err.message}`)));
  });
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
  const imageDir = join(findQemuDir(), "images");
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

        const imageDir = join(findQemuDir(), "images");
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
    .action(async (opts) => {
      const arch = resolveArch(opts.arch);
      const img = join(findQemuDir(), "images", `stack-emulator-${arch}.qcow2`);
      if (!existsSync(img)) {
        console.log("No emulator image found. Pulling latest...");
        pullRelease(arch);
      }
      await runEmulator("start", { EMULATOR_ARCH: arch });
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
