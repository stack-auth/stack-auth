import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect } from "vitest";

const enabled = process.env.HEXCLAVE_E2E_DIAGNOSTICS === "true";
const pass = process.env.HEXCLAVE_E2E_DIAGNOSTIC_PASS ?? "unknown";
const runnerTemp = process.env.RUNNER_TEMP;

type WaitRecord = {
  file?: string,
  name: string,
  durationMs: number,
  polls: number,
  completed: boolean,
};

type RequestRecord = {
  file?: string,
  durationMs: number,
  method: string,
  path: string,
  status: number,
};

const waits: WaitRecord[] = [];
const requests: RequestRecord[] = [];

export function isE2eDiagnosticsEnabled(): boolean {
  return enabled;
}

export function recordConvergenceWait(record: WaitRecord): void {
  if (!enabled) return;
  waits.push({ ...record, file: expect.getState().testPath });
}

export function recordClientRequest(record: RequestRecord): void {
  if (!enabled) return;
  requests.push({ ...record, file: expect.getState().testPath });
}

export function flushE2eDiagnostics(): void {
  if (!enabled || runnerTemp === undefined) return;
  const outputPath = join(runnerTemp, `hexclave-e2e-diagnostics-${pass}-${process.pid}.untracked.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify({
    pass,
    pid: process.pid,
    waits,
    requests,
  }));
}
