import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CliError } from "./errors.js";

export const DEFAULT_EMULATOR_BACKEND_PORT = 26701;
export const DEFAULT_EMULATOR_DASHBOARD_PORT = 26700;
export const DEFAULT_EMULATOR_MINIO_PORT = 26702;
export const DEFAULT_EMULATOR_INBUCKET_PORT = 26703;
export const DEFAULT_EMULATOR_MOCK_OAUTH_PORT = 26704;

export function envPort(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid ${name}: ${raw}`);
  }
  return parsed;
}

// First-set-wins lookup across alias env names. Use this for port vars where
// we want a STACK_-prefixed canonical name plus a legacy unprefixed alias.
export function envPortFirstSet(names: [string, ...string[]], fallback: number): number {
  for (const name of names) {
    if (process.env[name]) return envPort(name, fallback);
  }
  return fallback;
}

export function emulatorHome(): string {
  return process.env.STACK_EMULATOR_HOME ?? join(homedir(), ".stack", "emulator");
}

export function emulatorRunDir(): string {
  return join(emulatorHome(), "run");
}

export function emulatorImageDir(): string {
  return join(emulatorHome(), "images");
}

export function internalPckPath(): string {
  return join(emulatorRunDir(), "vm", "internal-pck");
}

export function emulatorBackendPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_BACKEND_PORT", "EMULATOR_BACKEND_PORT"], DEFAULT_EMULATOR_BACKEND_PORT);
}

export function emulatorDashboardPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_DASHBOARD_PORT", "EMULATOR_DASHBOARD_PORT"], DEFAULT_EMULATOR_DASHBOARD_PORT);
}

export function emulatorMinioPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_MINIO_PORT", "EMULATOR_MINIO_PORT"], DEFAULT_EMULATOR_MINIO_PORT);
}

export function emulatorInbucketPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_INBUCKET_PORT", "EMULATOR_INBUCKET_PORT"], DEFAULT_EMULATOR_INBUCKET_PORT);
}

export function emulatorMockOAuthPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_MOCK_OAUTH_PORT", "EMULATOR_MOCK_OAUTH_PORT"], DEFAULT_EMULATOR_MOCK_OAUTH_PORT);
}

// Polls the emulator runtime dir for the internal PCK file with exponential
// backoff. Returns the trimmed contents on success, or `null` if the file is
// still missing/empty when the deadline elapses. Non-ENOENT read errors throw.
//
// Two callers care about this race:
//   - `stack emulator start --config-file` waits up to ~60s for the VM to come
//     up after a fresh boot.
//   - `stack exec` (local default) waits a much shorter window so we still
//     surface "emulator not running" quickly while absorbing a typical race
//     between `stack emulator start` and the next CLI invocation.
export async function pollInternalPck(timeoutMs: number): Promise<string | null> {
  const pckPath = internalPckPath();
  const deadline = performance.now() + timeoutMs;
  let delay = 50;
  while (true) {
    try {
      const contents = readFileSync(pckPath, "utf-8").trim();
      if (contents) return contents;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (performance.now() >= deadline) return null;
    const remaining = deadline - performance.now();
    await new Promise((r) => setTimeout(r, Math.min(delay, remaining)));
    delay = Math.min(delay * 2, 2000);
  }
}
