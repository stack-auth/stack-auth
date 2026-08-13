import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { threadId } from "node:worker_threads";
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
  sleepDurationMs?: number,
};

type RequestRecord = {
  clientRequestId?: string,
  serverRequestId?: string,
  file?: string,
  durationMs: number,
  kind?: "app" | "diagnostic",
  method: string,
  path: string,
  status: number,
};

type DiagnosticCrawlRecord = {
  file?: string,
  name: string,
  durationMs: number,
};

type BacklogRecord = {
  pipeline: "email-outbox" | "external-db-sync",
  pendingCount: number,
  oldestPendingAgeMs: number | null,
  sampledAtMs: number,
};

const waits: WaitRecord[] = [];
const requests: RequestRecord[] = [];
const diagnosticCrawls: DiagnosticCrawlRecord[] = [];
const backlogs: BacklogRecord[] = [];
const fileStartedAt = performance.now();
let totalConvergenceSleepMs = 0;

export function isE2eDiagnosticsEnabled(): boolean {
  return enabled;
}

export function recordConvergenceWait(record: WaitRecord): void {
  if (!enabled) return;
  totalConvergenceSleepMs += record.sleepDurationMs ?? 0;
  waits.push({ ...record, file: expect.getState().testPath });
}

export function recordPipelineBacklog(record: Omit<BacklogRecord, "sampledAtMs">): void {
  if (!enabled || backlogs.length >= 512) return;
  backlogs.push({
    ...record,
    sampledAtMs: performance.timeOrigin + performance.now(),
  });
}

export function recordClientRequest(record: RequestRecord): void {
  if (!enabled) return;
  requests.push({ ...record, file: expect.getState().testPath });
}

export function recordDiagnosticCrawl(record: DiagnosticCrawlRecord): void {
  if (!enabled) return;
  diagnosticCrawls.push({ ...record, file: expect.getState().testPath });
}

export function flushE2eDiagnostics(): void {
  if (!enabled || runnerTemp === undefined) return;
  const testFile = expect.getState().testPath ?? "unknown";
  const testFileHash = createHash("sha256").update(testFile).digest("hex").slice(0, 16);
  const outputPath = join(runnerTemp, `hexclave-e2e-diagnostics-${pass}-${process.pid}-${threadId}-${testFileHash}.untracked.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  const fileWallDurationMs = performance.now() - fileStartedAt;
  const httpRequestDurationMs = requests.reduce((total, request) => total + (request.kind === "diagnostic" ? 0 : request.durationMs), 0);
  const diagnosticCrawlDurationMs = diagnosticCrawls.reduce((total, crawl) => total + crawl.durationMs, 0);
  const convergenceSleepDurationMs = totalConvergenceSleepMs;
  writeFileSync(outputPath, JSON.stringify({
    pass,
    pid: process.pid,
    threadId,
    file: testFile,
    waits,
    requests,
    diagnosticCrawls,
    backlogs,
    summary: {
      fileWallDurationMs,
      httpRequestDurationMs,
      convergenceSleepDurationMs,
      diagnosticCrawlDurationMs,
      residualDurationMs: fileWallDurationMs - httpRequestDurationMs - convergenceSleepDurationMs - diagnosticCrawlDurationMs,
    },
  }));
}
