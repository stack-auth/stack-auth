import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { EventEmitter } from "events";
import * as childProcess from "child_process";
import * as ownPackage from "./own-package.js";

// `spawn` is a non-configurable built-in export, so it can't be vi.spyOn'd;
// replace it with a vi.fn. Everything else in child_process stays real.
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: vi.fn() };
});

import {
  buildNpxInvocation,
  decidePostReexec,
  decideReexec,
  DISABLE_AUTO_UPDATE_ENV,
  isEnvFlagEnabled,
  maybeReexecToLatest,
  REEXEC_MARKER_ENV,
  shouldAutoUpdate,
  signalReexecStartedIfChild,
  SKIP_AUTO_UPDATE_ENV,
} from "./self-update.js";
import type { OwnPackage } from "./own-package.js";

describe("isEnvFlagEnabled", () => {
  it("treats absent / empty / 0 / false as disabled", () => {
    expect(isEnvFlagEnabled(undefined)).toBe(false);
    expect(isEnvFlagEnabled("")).toBe(false);
    expect(isEnvFlagEnabled("  ")).toBe(false);
    expect(isEnvFlagEnabled("0")).toBe(false);
    expect(isEnvFlagEnabled("false")).toBe(false);
    expect(isEnvFlagEnabled("FALSE")).toBe(false);
  });

  it("treats other values as enabled", () => {
    expect(isEnvFlagEnabled("1")).toBe(true);
    expect(isEnvFlagEnabled("true")).toBe(true);
    expect(isEnvFlagEnabled("yes")).toBe(true);
  });
});

describe("shouldAutoUpdate", () => {
  it("returns true for an empty environment", () => {
    expect(shouldAutoUpdate({})).toBe(true);
  });

  it("is disabled for the re-exec'd child", () => {
    expect(shouldAutoUpdate({ [SKIP_AUTO_UPDATE_ENV]: "1" })).toBe(false);
  });

  it("is disabled when the user opts out", () => {
    expect(shouldAutoUpdate({ [DISABLE_AUTO_UPDATE_ENV]: "1" })).toBe(false);
  });

  it("still auto-updates in CI so it matches what developers run locally", () => {
    expect(shouldAutoUpdate({ CI: "true" })).toBe(true);
    expect(shouldAutoUpdate({ CI: "1" })).toBe(true);
  });

  it("does not skip when an opt-out flag is a falsy string", () => {
    expect(shouldAutoUpdate({ [SKIP_AUTO_UPDATE_ENV]: "0" })).toBe(true);
    expect(shouldAutoUpdate({ [DISABLE_AUTO_UPDATE_ENV]: "false" })).toBe(true);
  });
});

describe("buildNpxInvocation", () => {
  it("pins @latest and forwards the subcommand through the bin", () => {
    const { command, args } = buildNpxInvocation({
      packageName: "@hexclave/cli",
      binName: "stack",
      forwardArgs: ["dev", "--config-file", "./stack.config.ts", "--", "npm", "run", "dev:app"],
    });
    expect(command).toMatch(/^npx(\.cmd)?$/);
    expect(args).toEqual([
      "--yes",
      "--min-release-age=0",
      "-p",
      "@hexclave/cli@latest",
      "stack",
      "dev",
      "--config-file",
      "./stack.config.ts",
      "--",
      "npm",
      "run",
      "dev:app",
    ]);
  });

  it("overrides any global npm cooldown so a just-published version is fetched", () => {
    const { args } = buildNpxInvocation({
      packageName: "@hexclave/cli",
      binName: "stack",
      forwardArgs: [],
    });
    // npm's `min-release-age` (>=11.10.0) would otherwise block the latest.
    expect(args).toContain("--min-release-age=0");
  });

  it("preserves args that start with dashes or contain spaces as individual argv elements", () => {
    const { args } = buildNpxInvocation({
      packageName: "@hexclave/cli",
      binName: "stack",
      forwardArgs: ["dev", "--flag=a b", "--", "echo", "hello world"],
    });
    expect(args).toEqual([
      "--yes", "--min-release-age=0", "-p", "@hexclave/cli@latest", "stack",
      "dev", "--flag=a b", "--", "echo", "hello world",
    ]);
  });

  it("uses npx.cmd and requests a shell on Windows (needed to spawn a .cmd post-CVE-2024-27980)", () => {
    const spy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      const invocation = buildNpxInvocation({
        packageName: "@hexclave/cli", binName: "stack", forwardArgs: [],
      });
      expect(invocation.command).toBe("npx.cmd");
      expect(invocation.shell).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("spawns npx directly without a shell off Windows", () => {
    const spy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    try {
      const invocation = buildNpxInvocation({
        packageName: "@hexclave/cli", binName: "stack", forwardArgs: [],
      });
      expect(invocation.command).toBe("npx");
      expect(invocation.shell).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("decideReexec", () => {
  const pkg: OwnPackage = { name: "@hexclave/cli", version: "2.8.109", binName: "stack" };

  it("does not re-exec when auto-update is disabled", () => {
    expect(decideReexec({ env: { [SKIP_AUTO_UPDATE_ENV]: "1" }, pkg, forwardArgs: [] }))
      .toEqual({ reexec: false, reason: "disabled" });
  });

  it("does not re-exec when own package is unresolvable", () => {
    expect(decideReexec({ env: {}, pkg: null, forwardArgs: [] }))
      .toEqual({ reexec: false, reason: "no-package" });
  });

  it("re-execs through a pinned `npx @latest` invocation when eligible", () => {
    const decision = decideReexec({
      env: {},
      pkg,
      forwardArgs: ["dev", "--config-file", "x"],
    });
    expect(decision.reexec).toBe(true);
    if (decision.reexec) {
      expect(decision.invocation.args).toEqual([
        "--yes", "--min-release-age=0", "-p", "@hexclave/cli@latest", "stack", "dev", "--config-file", "x",
      ]);
    }
  });
});

describe("maybeReexecToLatest", () => {
  const optOutKeys = [SKIP_AUTO_UPDATE_ENV, DISABLE_AUTO_UPDATE_ENV];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of optOutKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of optOutKeys) {
      if (savedEnv[key] == null) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  it("returns without re-exec (never spawning npx) when auto-update is opted out", async () => {
    // With the opt-out set, the disabled short-circuit fires before any spawn,
    // so the installed CLI keeps running. Resolving here without throwing or
    // hanging proves we did not re-exec into `npx @latest`.
    process.env[DISABLE_AUTO_UPDATE_ENV] = "1";
    await expect(maybeReexecToLatest({ forwardArgs: ["dev"] })).resolves.toBeUndefined();
  });
});

describe("decidePostReexec", () => {
  it("propagates the exit code when the CLI ran to completion (code 0)", () => {
    expect(decidePostReexec({ result: { exited: true, code: 0, signal: null }, started: true }))
      .toEqual({ kind: "exit", code: 0 });
  });

  it("propagates a nonzero exit code when the CLI actually started (real command failure)", () => {
    // The re-exec'd CLI ran (marker present) and the wrapped command failed — we
    // must surface that failure, not silently re-run it.
    expect(decidePostReexec({ result: { exited: true, code: 1, signal: null }, started: true }))
      .toEqual({ kind: "exit", code: 1 });
  });

  it("falls back when npx exits nonzero before the CLI starts (e.g. Lock compromised)", () => {
    // npm errored during install/lock; our CLI never ran. Don't take down dev —
    // run the installed CLI instead.
    const action = decidePostReexec({ result: { exited: true, code: 1, signal: null }, started: false });
    expect(action.kind).toBe("fallback");
  });

  it("propagates (does not fall back) when npx was killed by a signal before the CLI started", () => {
    // e.g. the user pressed Ctrl-C during the download. They want to abort, not
    // get a fresh dev session launched on the installed CLI.
    expect(decidePostReexec({ result: { exited: true, code: 130, signal: "SIGINT" }, started: false }))
      .toEqual({ kind: "exit", code: 130 });
  });

  it("falls back when npx cannot be spawned at all", () => {
    const action = decidePostReexec({ result: { exited: false, error: "spawn npx ENOENT" }, started: false });
    expect(action.kind).toBe("fallback");
  });
});

describe("signalReexecStartedIfChild", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hexclave-reexec-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the marker file when the marker env var is set (we are the child)", () => {
    const marker = join(dir, "started");
    signalReexecStartedIfChild({ [REEXEC_MARKER_ENV]: marker });
    expect(existsSync(marker)).toBe(true);
    expect(readFileSync(marker, "utf8")).toBe("1");
  });

  it("does nothing when no marker env var is set (normal top-level run)", () => {
    const marker = join(dir, "started");
    signalReexecStartedIfChild({});
    expect(existsSync(marker)).toBe(false);
  });

  it("does not throw when the marker path is unwritable (best-effort)", () => {
    const marker = join(dir, "nonexistent-subdir", "started");
    expect(() => signalReexecStartedIfChild({ [REEXEC_MARKER_ENV]: marker })).not.toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});

// End-to-end wiring of maybeReexecToLatest (marker -> spawn -> existence check ->
// decidePostReexec). The decision functions are pure-tested above; these guard
// against the glue regressing.
describe("maybeReexecToLatest fallback wiring", () => {
  const managedKeys = [SKIP_AUTO_UPDATE_ENV, DISABLE_AUTO_UPDATE_ENV, REEXEC_MARKER_ENV];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of managedKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    vi.spyOn(ownPackage, "getOwnPackage").mockReturnValue({
      name: "@hexclave/cli",
      version: "1.0.0",
      binName: "hexclave",
    });
  });

  afterEach(() => {
    for (const key of managedKeys) {
      if (savedEnv[key] == null) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.restoreAllMocks();
  });

  // Fake npx child. `writeMarker` simulates whether the re-exec'd CLI touched the
  // marker (as signalReexecStartedIfChild would) before the process closes.
  function mockNpxChild(opts: { writeMarker: boolean }): EventEmitter & { pid: number, kill: () => void } {
    const child = Object.assign(new EventEmitter(), { pid: 4242, kill: () => {} });
    vi.mocked(childProcess.spawn).mockImplementation(((
      _command: string,
      _args: readonly string[],
      spawnOpts: { env?: NodeJS.ProcessEnv },
    ) => {
      if (opts.writeMarker) {
        const markerFile = spawnOpts.env?.[REEXEC_MARKER_ENV];
        if (markerFile != null) writeFileSync(markerFile, "1");
      }
      return child;
    }) as unknown as typeof childProcess.spawn);
    return child;
  }

  it("falls back (never calls process.exit) when npx exits nonzero without the CLI starting", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
      throw new Error("process.exit should not have been called");
    }) as never));
    const child = mockNpxChild({ writeMarker: false });

    const promise = maybeReexecToLatest({ forwardArgs: ["dev"] });
    child.emit("close", 1, null);

    await expect(promise).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("propagates the exit code (calls process.exit) when the CLI started then failed", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
      // Throw so we don't actually exit the test runner; the SUT's catch swallows it.
      throw new Error("__exit__");
    }) as never));
    const child = mockNpxChild({ writeMarker: true });

    const promise = maybeReexecToLatest({ forwardArgs: ["dev"] });
    child.emit("close", 1, null);

    await promise;
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("propagates a nonzero, non-NaN code when killed by a signal missing from os.constants", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((() => {
      throw new Error("__exit__");
    }) as never));
    const child = mockNpxChild({ writeMarker: false });

    const promise = maybeReexecToLatest({ forwardArgs: ["dev"] });
    // SIGSTKFLT is absent from os.constants.signals on macOS (present on Linux).
    // Either way the abort must surface as a real nonzero code, never NaN.
    child.emit("close", null, "SIGSTKFLT");

    await promise;
    expect(exitSpy).toHaveBeenCalledTimes(1);
    const code = exitSpy.mock.calls[0][0];
    expect(typeof code).toBe("number");
    expect(Number.isNaN(code as number)).toBe(false);
    expect(code as number).toBeGreaterThan(0);
  });
});
