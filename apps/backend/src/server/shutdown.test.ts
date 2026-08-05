import { describe, expect, it, vi } from "vitest";
import { backendShutdownBudget, runShutdownOperationWithTimeout, shutdownBackend, type BackendShutdownLogEvent } from "./shutdown";

describe("shutdownBackend", () => {
  it("keeps the hard exit inside the shortest supported platform grace period", () => {
    expect(backendShutdownBudget.hardExitTimeoutMs).toBeLessThan(backendShutdownBudget.platformGracePeriodMs);
    expect(
      backendShutdownBudget.hardExitTimeoutMs
      - backendShutdownBudget.backgroundTasksTimeoutMs
      - backendShutdownBudget.databaseTimeoutMs
      - backendShutdownBudget.instrumentationTimeoutMs,
    ).toBe(1000);
  });

  it("bounds individual shutdown operations so later cleanup can still run", async () => {
    vi.useFakeTimers();
    try {
      const operation = runShutdownOperationWithTimeout(
        "database disconnect",
        100,
        async () => await new Promise<never>(() => {}),
      );
      const rejection = expect(operation).rejects.toThrow("database disconnect did not complete within 100ms");
      await vi.advanceTimersByTimeAsync(100);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops ingress before draining resources and reports completion", async () => {
    const calls: string[] = [];
    const events: BackendShutdownLogEvent[] = [];

    await shutdownBackend("SIGTERM", {
      stopAcceptingRequests: async () => {
        calls.push("http-server");
      },
      drainBackgroundTasks: async () => {
        calls.push("background-tasks");
      },
      disconnectDatabases: async () => {
        calls.push("databases");
      },
      closeInstrumentation: async () => {
        calls.push("instrumentation");
      },
      log: (event) => events.push(event),
    });

    expect(calls).toEqual([
      "http-server",
      "background-tasks",
      "databases",
      "instrumentation",
    ]);
    expect(events.map((event) => event.event)).toEqual([
      "backend.shutdown.started",
      "backend.shutdown.completed",
    ]);
  });

  it("continues cleanup after a failed step and reports every failure", async () => {
    const disconnectDatabases = vi.fn(() => {
      throw new Error("database disconnect failed");
    });
    const closeInstrumentation = vi.fn(async () => {
      throw new Error("instrumentation close failed");
    });
    const events: BackendShutdownLogEvent[] = [];

    await expect(shutdownBackend("SIGINT", {
      stopAcceptingRequests: async () => {},
      drainBackgroundTasks: async () => {},
      disconnectDatabases,
      closeInstrumentation,
      log: (event) => events.push(event),
    })).rejects.toThrow("Backend shutdown failed in: databases, instrumentation");

    expect(disconnectDatabases).toHaveBeenCalledOnce();
    expect(closeInstrumentation).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({
      event: "backend.shutdown.failed",
      signal: "SIGINT",
      failedSteps: ["databases", "instrumentation"],
    });
  });
});
