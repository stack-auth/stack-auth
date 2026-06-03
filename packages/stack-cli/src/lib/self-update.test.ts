import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNpxInvocation,
  decideReexec,
  DISABLE_AUTO_UPDATE_ENV,
  isEnvFlagEnabled,
  maybeReexecToLatest,
  shouldAutoUpdate,
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
