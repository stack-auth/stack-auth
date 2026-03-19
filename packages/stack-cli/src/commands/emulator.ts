import { Command } from "commander";
import { execFileSync, spawn } from "child_process";
import { existsSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, resolve } from "path";
import { CliError } from "../lib/errors.js";

const DEFAULT_REPO = "stack-auth/stack-auth";
const DEFAULT_BRANCH = "dev";

type EmulatorArch = "arm64" | "amd64";

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

function runScript(qemuDir: string, script: string, args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(qemuDir, script), args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      cwd: qemuDir,
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new CliError(`${script} exited with code ${code}`));
    });
    child.on("error", (err) => {
      reject(new CliError(`Failed to run ${script}: ${err.message}`));
    });
  });
}

function runEmulatorAction(action: string, env?: Record<string, string>): Promise<void> {
  return runScript(findQemuDir(), "run-emulator.sh", [action], env);
}

function ghRelease(args: string[]): string {
  try {
    return execFileSync("gh", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (err: unknown) {
    if (err instanceof Error && "stderr" in err) {
      const { stderr } = err as Error & { stderr: string };
      throw new CliError(`GitHub CLI error: ${stderr}`);
    }
    throw new CliError("GitHub CLI (gh) is required. Install: https://cli.github.com/");
  }
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
      const arch: EmulatorArch = opts.arch || detectArch();
      const repo = opts.repo || DEFAULT_REPO;
      const branch = opts.branch || DEFAULT_BRANCH;
      const tag = opts.tag || `emulator-${branch}-latest`;
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
    });

  emulator
    .command("run")
    .description("Start the emulator (auto-pulls if no image exists)")
    .option("--arch <arch>", "Target architecture")
    .action(async (opts) => {
      const arch: EmulatorArch = opts.arch || detectArch();
      const qemuDir = findQemuDir();
      const img = join(qemuDir, "images", `stack-emulator-${arch}.qcow2`);

      if (!existsSync(img)) {
        console.log("No emulator image found. Pulling latest...");
        await program.parseAsync(["node", "stack", "emulator", "pull", "--arch", arch], { from: "user" });
      }

      await runScript(qemuDir, "run-emulator.sh", ["start"], { EMULATOR_ARCH: arch });
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
      const arch = opts.arch || detectArch();
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
