import { describe, expect, it, vi } from "vitest";
import { shutdownBackend, type BackendShutdownLogEvent } from "./shutdown";

describe("shutdownBackend", () => {
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
