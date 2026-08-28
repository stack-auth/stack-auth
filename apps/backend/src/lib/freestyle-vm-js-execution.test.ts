import type { CreateVmOptions } from "freestyle";
import { describe, expect, test, vi } from "vitest";
import {
  executeJavascriptInFreestyleVm,
  type FreestyleExecutionVm,
} from "./freestyle-vm-js-execution";

function createFakeVm(options: {
  exitCode?: number | null,
  resultJson?: string,
  deleteError?: Error,
  onPtyOpen?: () => void,
} = {}) {
  const writes = new Map<string, string>();
  const directories: string[] = [];
  const commands: string[] = [];
  const detach = vi.fn();
  const deleteVm = vi.fn(async () => {
    if (options.deleteError != null) throw options.deleteError;
  });
  const vm: FreestyleExecutionVm = {
    id: "vm-test",
    makeDirectory: async (path) => {
      directories.push(path);
    },
    writeTextFile: async (path, content) => {
      writes.set(path, content);
    },
    readTextFile: async () => options.resultJson ?? JSON.stringify({
      status: "ok",
      data: { rendered: true },
    }),
    openPty: async (ptyOptions) => {
      commands.push(ptyOptions.exec);
      options.onPtyOpen?.();
      if (options.exitCode !== null) {
        queueMicrotask(() => ptyOptions.onExit(options.exitCode ?? 0));
      }
      return { detach };
    },
    delete: deleteVm,
  };
  return { vm, writes, directories, commands, detach, deleteVm };
}

describe("executeJavascriptInFreestyleVm", () => {
  test("boots the configured snapshot, runs through PTY, and deletes the VM", async () => {
    const fake = createFakeVm();
    let createOptions: CreateVmOptions | undefined;
    const result = await executeJavascriptInFreestyleVm({
      snapshotId: "sandbox-snapshot",
      code: "export default async () => ({ status: 'ok', data: 42 });",
      nodeModules: { react: "19.1.1" },
      executionTimeoutMs: 630_000,
      scheduleCleanup: vi.fn(),
      onCleanupError: vi.fn(),
      createVm: async (options) => {
        createOptions = options;
        return fake.vm;
      },
    });

    expect(result).toEqual({ status: "ok", data: { rendered: true } });
    expect(createOptions).toMatchObject({
      snapshotId: "sandbox-snapshot",
      automaticRestart: false,
      autoDeleteSeconds: 0,
      maxRunSeconds: 690,
      ttlSeconds: 930,
      metadata: { app: "hexclave", purpose: "javascript-execution" },
      firewall: {
        rules: [{ action: "allow", source: {}, destination: { public: true } }],
      },
    });
    expect(fake.directories).toHaveLength(1);
    const jobDirectory = fake.directories[0];
    expect(fake.writes.get(`${jobDirectory}/code.mjs`)).toContain("data: 42");
    expect(JSON.parse(fake.writes.get(`${jobDirectory}/package.json`) ?? "")).toEqual({
      private: true,
      type: "module",
      dependencies: { react: "19.1.1" },
    });
    expect(fake.commands).toEqual([
      `/usr/local/bin/hexclave-run-job ${jobDirectory}`,
    ]);
    expect(fake.detach).toHaveBeenCalledOnce();
    expect(fake.deleteVm).toHaveBeenCalledOnce();
  });

  test("rejects a failed runner and still deletes its VM", async () => {
    const fake = createFakeVm({ exitCode: 7 });

    await expect(executeJavascriptInFreestyleVm({
      snapshotId: "sandbox-snapshot",
      code: "export default () => 42;",
      nodeModules: {},
      scheduleCleanup: vi.fn(),
      onCleanupError: vi.fn(),
      createVm: async () => fake.vm,
    })).rejects.toThrow("runner exited with status 7");

    expect(fake.detach).toHaveBeenCalledOnce();
    expect(fake.deleteVm).toHaveBeenCalledOnce();
  });

  test("reports cleanup failures without replacing a successful result", async () => {
    const cleanupError = new Error("delete failed");
    const fake = createFakeVm({ deleteError: cleanupError });
    const onCleanupError = vi.fn();

    await expect(executeJavascriptInFreestyleVm({
      snapshotId: "sandbox-snapshot",
      code: "export default () => ({ status: 'ok', data: 42 });",
      nodeModules: {},
      scheduleCleanup: vi.fn(),
      onCleanupError,
      createVm: async () => fake.vm,
    })).resolves.toEqual({ status: "ok", data: { rendered: true } });

    expect(onCleanupError).toHaveBeenCalledWith("vm-test", cleanupError);
  });

  test("schedules deletion without delaying an aborted invocation", async () => {
    const controller = new AbortController();
    const abortReason = new Error("request ended");
    const fake = createFakeVm({
      exitCode: null,
      onPtyOpen: () => queueMicrotask(() => controller.abort(abortReason)),
    });
    let scheduledCleanup: Promise<void> | undefined;
    const scheduleCleanup = vi.fn((cleanup: Promise<void>) => {
      scheduledCleanup = cleanup;
    });

    await expect(executeJavascriptInFreestyleVm({
      snapshotId: "sandbox-snapshot",
      code: "export default () => 42;",
      nodeModules: {},
      signal: controller.signal,
      scheduleCleanup,
      onCleanupError: vi.fn(),
      createVm: async () => fake.vm,
    })).rejects.toBe(abortReason);

    expect(scheduleCleanup).toHaveBeenCalledOnce();
    await scheduledCleanup;
    expect(fake.deleteVm).toHaveBeenCalledOnce();
  });

  test("deletes a VM that finishes creating after the invocation aborts", async () => {
    const controller = new AbortController();
    const abortReason = new Error("request ended during VM creation");
    const fake = createFakeVm();
    let resolveCreate: (vm: FreestyleExecutionVm) => void = () => {
      throw new Error("create resolver used before initialization");
    };
    const createPromise = new Promise<FreestyleExecutionVm>((resolve) => {
      resolveCreate = resolve;
    });
    let scheduledCleanup: Promise<void> | undefined;
    const scheduleCleanup = vi.fn((cleanup: Promise<void>) => {
      scheduledCleanup = cleanup;
    });

    const execution = executeJavascriptInFreestyleVm({
      snapshotId: "sandbox-snapshot",
      code: "export default () => 42;",
      nodeModules: {},
      signal: controller.signal,
      scheduleCleanup,
      onCleanupError: vi.fn(),
      createVm: async () => await createPromise,
    });
    controller.abort(abortReason);

    await expect(execution).rejects.toBe(abortReason);
    expect(scheduleCleanup).toHaveBeenCalledOnce();
    expect(fake.deleteVm).not.toHaveBeenCalled();

    resolveCreate(fake.vm);
    await scheduledCleanup;
    expect(fake.deleteVm).toHaveBeenCalledOnce();
    expect(fake.commands).toEqual([]);
  });
});
