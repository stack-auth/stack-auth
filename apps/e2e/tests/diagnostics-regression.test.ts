import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringCompare } from "@hexclave/shared/dist/utils/strings";
import { expect } from "vitest";
import { test } from "./helpers";

type DiagnosticReport = {
  pass: string,
  file: string,
  requests: Array<{ path: string }>,
};

function isDiagnosticReport(value: unknown): value is DiagnosticReport {
  if (value == null || typeof value !== "object" || !("pass" in value) || typeof value.pass !== "string" || !("file" in value) || typeof value.file !== "string" || !("requests" in value) || !Array.isArray(value.requests)) return false;
  return value.requests.every(request => request != null && typeof request === "object" && "path" in request && typeof request.path === "string");
}

test("preserves diagnostics from multiple files on one worker", () => {
  const runnerTemp = mkdtempSync(join(tmpdir(), "hexclave-e2e-diagnostics-regression-"));
  const e2eDirectory = join(import.meta.dirname, "..");
  try {
    execFileSync("pnpm", [
      "exec",
      "vitest",
      "run",
      "--config",
      "vitest.config.ts",
      "--min-workers=1",
      "--max-workers=1",
      "tests/diagnostics-regression/worker-one.test.ts",
      "tests/diagnostics-regression/worker-two.test.ts",
    ], {
      cwd: e2eDirectory,
      env: {
        ...process.env,
        HEXCLAVE_E2E_DIAGNOSTICS: "true",
        HEXCLAVE_E2E_DIAGNOSTIC_PASS: "regression",
        RUNNER_TEMP: runnerTemp,
      },
      stdio: "pipe",
      timeout: 60_000,
      killSignal: "SIGTERM",
      maxBuffer: 8 * 1024 * 1024,
    });

    const reports = readdirSync(runnerTemp)
      .filter(file => file.startsWith("hexclave-e2e-diagnostics-regression-") && file.endsWith(".json"))
      .map(file => {
        const parsed: unknown = JSON.parse(readFileSync(join(runnerTemp, file), "utf8"));
        if (!isDiagnosticReport(parsed)) throw new Error(`Invalid diagnostics report: ${file}`);
        return { file, report: parsed };
      });
    expect(reports).toHaveLength(2);
    expect(reports.map(({ report }) => report.pass)).toEqual(["regression", "regression"]);
    expect(reports.map(({ report }) => report.file.endsWith("tests/diagnostics-regression/worker-one.test.ts")).sort((left, right) => Number(left) - Number(right))).toEqual([false, true]);
    expect(reports.map(({ report }) => report.file.endsWith("tests/diagnostics-regression/worker-two.test.ts")).sort((left, right) => Number(left) - Number(right))).toEqual([false, true]);
    expect(reports.flatMap(({ report }) => report.requests.map(request => request.path)).sort(stringCompare)).toEqual([
      "/diagnostics-regression/one",
      "/diagnostics-regression/two",
    ]);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
});
