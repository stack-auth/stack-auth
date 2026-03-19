import { Command } from "commander";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CliError } from "../lib/errors.js";

const EMULATOR_BINARY = "stack-emulator";
const EMULATOR_BASE_URL = "http://localhost:32102";
const EMULATOR_INTERNAL_PUBLISHABLE_CLIENT_KEY = "this-publishable-client-key-is-for-local-development-only";
const CONFIG_DIR = path.join(os.homedir(), ".config", "stack-auth");
const PID_FILE = path.join(CONFIG_DIR, "emulator.pid");
const LOG_FILE = path.join(CONFIG_DIR, "emulator.log");

function readPid(): number | null {
  try {
    const content = fs.readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(pid) + "\n");
}

function removePid(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore if already gone
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForEmulator(): Promise<void> {
  const healthUrl = `${EMULATOR_BASE_URL}/api/v1/health`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        return;
      }
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  throw new CliError("Emulator did not become ready within 30 seconds. Check logs: " + LOG_FILE);
}

async function registerConfigFile(configFile: string): Promise<void> {
  const absoluteFilePath = path.resolve(configFile);

  const res = await fetch(`${EMULATOR_BASE_URL}/api/v1/internal/local-emulator/project`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-stack-project-id": "internal",
      "x-stack-access-type": "client",
      "x-stack-publishable-client-key": EMULATOR_INTERNAL_PUBLISHABLE_CLIENT_KEY,
    },
    body: JSON.stringify({ absolute_file_path: absoluteFilePath }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new CliError(`Failed to register config file with emulator: ${text}`);
  }

  const body = await res.json() as {
    project_id: string,
    secret_server_key: string,
    super_secret_admin_key: string,
  };

  console.log(`Config file registered: ${absoluteFilePath}`);
  console.log(`  Project ID:             ${body.project_id}`);
  console.log(`  Secret Server Key:      ${body.secret_server_key}`);
  console.log(`  Super Secret Admin Key: ${body.super_secret_admin_key}`);
  console.log(`  API URL:                ${EMULATOR_BASE_URL}`);
}

async function startEmulator(options?: { configFile?: string }): Promise<number> {
  const existingPid = readPid();
  if (existingPid !== null) {
    if (isProcessAlive(existingPid)) {
      console.log(`Emulator is already running (PID ${existingPid})`);
      if (options?.configFile) {
        await waitForEmulator();
        await registerConfigFile(options.configFile);
      }
      return existingPid;
    }
    removePid();
  }

  const logFd = fs.openSync(LOG_FILE, "a");
  const child = spawn(EMULATOR_BINARY, [], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  if (child.pid === undefined) {
    fs.closeSync(logFd);
    throw new CliError(`Failed to start ${EMULATOR_BINARY}`);
  }

  writePid(child.pid);
  child.unref();
  fs.closeSync(logFd);

  console.log(`Emulator started (PID ${child.pid})`);
  console.log(`Logs: ${LOG_FILE}`);

  if (options?.configFile) {
    await waitForEmulator();
    await registerConfigFile(options.configFile);
  }

  return child.pid;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopEmulator(): Promise<void> {
  const pid = readPid();
  if (pid === null) {
    console.log("Emulator is not running");
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log("Emulator is not running (stale PID file removed)");
    removePid();
    return;
  }

  process.kill(pid, "SIGTERM");

  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (!isProcessAlive(pid)) {
      removePid();
      console.log(`Emulator stopped (PID ${pid})`);
      return;
    }
  }

  process.kill(pid, "SIGKILL");
  removePid();
  console.log(`Emulator killed (PID ${pid})`);
}

export function registerEmulatorCommand(program: Command) {
  const emulator = program
    .command("emulator")
    .description("Manage the local Stack emulator");

  emulator
    .command("start")
    .description("Start the emulator")
    .option("--config-file <path>", "Path to a config file for the emulator")
    .action(async (options: { configFile?: string }) => {
      await startEmulator(options);
    });

  emulator
    .command("stop")
    .description("Stop the emulator")
    .action(async () => {
      await stopEmulator();
    });

  emulator
    .command("run <cmd>")
    .description("Start the emulator, run a command, then stop the emulator")
    .option("--config-file <path>", "Path to a config file for the emulator")
    .action(async (cmd: string, options: { configFile?: string }) => {
      await startEmulator(options);

      const child = spawn(cmd, { stdio: "inherit", shell: true });

      const cleanup = () => {
        child.kill("SIGINT");
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);

      const code = await new Promise<number>((resolve) => {
        child.on("exit", (exitCode, signal) => {
          process.off("SIGINT", cleanup);
          process.off("SIGTERM", cleanup);
          resolve(exitCode ?? (signal ? 1 : 0));
        });
      });

      await stopEmulator();
      process.exit(code);
    });
}
