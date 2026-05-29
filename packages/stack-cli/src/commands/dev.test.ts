import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordLocalDashboardProcess } from "../lib/dev-env-state.js";
import { killLocalDashboard, processExists, shouldRestartDashboard } from "./dev.js";

describe("shouldRestartDashboard", () => {
  it("restarts only when ours is strictly newer than the running dashboard", () => {
    expect(shouldRestartDashboard("2.8.110", "2.8.109")).toBe(true);
    expect(shouldRestartDashboard("2.8.109", "2.8.109")).toBe(false);
    expect(shouldRestartDashboard("2.8.108", "2.8.109")).toBe(false);
  });

  it("reuses (does not restart) when either version is unknown", () => {
    // A dashboard recorded by a pre-feature CLI has no version field.
    expect(shouldRestartDashboard("2.8.110", undefined)).toBe(false);
    expect(shouldRestartDashboard(undefined, "2.8.109")).toBe(false);
    expect(shouldRestartDashboard(undefined, undefined)).toBe(false);
  });
});

describe("processExists", () => {
  it("returns true for the current process and false for an impossible pid", () => {
    expect(processExists(process.pid)).toBe(true);
    // pid 1 always exists; a huge pid effectively never does.
    expect(processExists(2_147_483_646)).toBe(false);
  });
});

describe("killLocalDashboard", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "dev-kill-"));
    process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
  });

  afterEach(() => {
    delete process.env.STACK_DEV_ENVS_PATH;
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does nothing when no dashboard pid is recorded", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Filter to our own signals: the worker-thread runtime may call
    // process.kill for its own bookkeeping, which isn't what we're asserting.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    await killLocalDashboard("http://127.0.0.1:26700");
    // No recorded pid → return before probing the process or polling the port.
    expect(fetchMock).not.toHaveBeenCalled();
    const targetedCalls = killSpy.mock.calls.filter(([, sig]) => sig === "SIGTERM" || sig === "SIGKILL");
    expect(targetedCalls).toHaveLength(0);
  });

  it("returns immediately without a wait loop when the process is already gone (ESRCH)", async () => {
    recordLocalDashboardProcess(26700, "s", 4242, "/tmp/x.log", "2.8.110");
    // processExists(0-probe) throws ESRCH → treated as not alive → early return.
    vi.spyOn(process, "kill").mockImplementation(() => {
      const e = new Error("no such process") as NodeJS.ErrnoException;
      e.code = "ESRCH";
      throw e;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await killLocalDashboard("http://127.0.0.1:26700");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not wait on or escalate a pid owned by another process (EPERM)", async () => {
    recordLocalDashboardProcess(26700, "s", 4242, "/tmp/x.log", "2.8.110");
    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      // signal 0 (existence probe) → EPERM means "exists but not ours".
      // SIGTERM → also EPERM; we must bail without looping.
      const e = new Error("operation not permitted") as NodeJS.ErrnoException;
      e.code = "EPERM";
      throw e;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await killLocalDashboard("http://127.0.0.1:26700");
    // processExists sees EPERM → alive; SIGTERM throws EPERM → early return.
    // We never poll /health, and never send SIGKILL.
    expect(fetchMock).not.toHaveBeenCalled();
    const sigkillCalls = killSpy.mock.calls.filter(([, sig]) => sig === "SIGKILL");
    expect(sigkillCalls).toHaveLength(0);
  });
});
