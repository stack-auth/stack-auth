import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { CliError } from "./errors.js";

export const DEFAULT_EMULATOR_BACKEND_PORT = 26701;
export const DEFAULT_EMULATOR_DASHBOARD_PORT = 26700;

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

export function internalPckPath(): string {
  return join(emulatorRunDir(), "vm", "internal-pck");
}

export function emulatorBackendPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_BACKEND_PORT", "EMULATOR_BACKEND_PORT"], DEFAULT_EMULATOR_BACKEND_PORT);
}

export function emulatorDashboardPort(): number {
  return envPortFirstSet(["STACK_EMULATOR_DASHBOARD_PORT", "EMULATOR_DASHBOARD_PORT"], DEFAULT_EMULATOR_DASHBOARD_PORT);
}

// Polls the development-environment runtime dir for the internal PCK file with
// exponential backoff. Returns the trimmed contents on success, or `null` if the
// file is still missing/empty when the deadline elapses. Non-ENOENT read errors
// throw.
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
