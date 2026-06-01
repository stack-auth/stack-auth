import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNpxInvocation,
  decideReexec,
  DISABLE_AUTO_UPDATE_ENV,
  isEnvFlagEnabled,
  isVersionNewer,
  maybeReexecToLatest,
  resolveLatestVersion,
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

  it("is disabled in CI", () => {
    expect(shouldAutoUpdate({ CI: "true" })).toBe(false);
  });

  it("still auto-updates when CI is a falsy string (CI=false / CI=0)", () => {
    expect(shouldAutoUpdate({ CI: "false" })).toBe(true);
    expect(shouldAutoUpdate({ CI: "0" })).toBe(true);
  });

  it("does not skip when an opt-out flag is a falsy string", () => {
    expect(shouldAutoUpdate({ [SKIP_AUTO_UPDATE_ENV]: "0" })).toBe(true);
    expect(shouldAutoUpdate({ [DISABLE_AUTO_UPDATE_ENV]: "false" })).toBe(true);
  });
});

describe("isVersionNewer", () => {
  it("compares core versions numerically", () => {
    expect(isVersionNewer("2.8.110", "2.8.109")).toBe(true);
    expect(isVersionNewer("2.9.0", "2.8.999")).toBe(true);
    expect(isVersionNewer("3.0.0", "2.999.999")).toBe(true);
    expect(isVersionNewer("2.8.109", "2.8.109")).toBe(false);
    expect(isVersionNewer("2.8.108", "2.8.109")).toBe(false);
  });

  it("does not treat double-digit segments as strings", () => {
    expect(isVersionNewer("2.8.10", "2.8.9")).toBe(true);
  });

  it("ranks a final release above a prerelease of the same core", () => {
    expect(isVersionNewer("2.8.109", "2.8.109-beta.1")).toBe(true);
    expect(isVersionNewer("2.8.109-beta.1", "2.8.109")).toBe(false);
  });

  it("returns false for unparseable versions (never downgrade or guess)", () => {
    expect(isVersionNewer("garbage", "2.8.109")).toBe(false);
    expect(isVersionNewer("2.8.110", "garbage")).toBe(false);
  });

  it("tolerates a leading v and surrounding whitespace on either side", () => {
    expect(isVersionNewer("v2.8.110", "2.8.109")).toBe(true);
    expect(isVersionNewer("2.8.110", "v2.8.109")).toBe(true);
    expect(isVersionNewer("  2.8.110  ", "2.8.109")).toBe(true);
    expect(isVersionNewer("v2.8.110", "v2.8.110")).toBe(false);
  });

  it("treats a two-segment version (x.y) as unparseable", () => {
    expect(isVersionNewer("2.8", "2.8.109")).toBe(false);
    expect(isVersionNewer("2.8.109", "2.8")).toBe(false);
  });

  it("ignores prerelease identifiers when both cores are equal prereleases", () => {
    // Only "release beats prerelease" is modeled; beta.2 is NOT newer than beta.1.
    expect(isVersionNewer("2.8.109-beta.2", "2.8.109-beta.1")).toBe(false);
    expect(isVersionNewer("2.8.109-beta.1", "2.8.109-beta.2")).toBe(false);
  });

  it("compares very large numeric segments correctly", () => {
    expect(isVersionNewer("2.8.1000000000", "2.8.999999999")).toBe(true);
    expect(isVersionNewer("10000000000.0.0", "9999999999.0.0")).toBe(true);
  });
});

describe("buildNpxInvocation", () => {
  it("pins the exact version and forwards the subcommand through the bin", () => {
    const { command, args } = buildNpxInvocation({
      packageName: "@hexclave/cli",
      version: "2.8.110",
      binName: "stack",
      forwardArgs: ["dev", "--config-file", "./stack.config.ts", "--", "npm", "run", "dev:app"],
    });
    expect(command).toMatch(/^npx(\.cmd)?$/);
    expect(args).toEqual([
      "--yes",
      "--min-release-age=0",
      "-p",
      "@hexclave/cli@2.8.110",
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
      version: "2.8.110",
      binName: "stack",
      forwardArgs: [],
    });
    // npm's `min-release-age` (>=11.10.0) would otherwise block the latest.
    expect(args).toContain("--min-release-age=0");
  });

  it("preserves args that start with dashes or contain spaces as individual argv elements", () => {
    const { args } = buildNpxInvocation({
      packageName: "@hexclave/cli",
      version: "2.8.110",
      binName: "stack",
      forwardArgs: ["dev", "--flag=a b", "--", "echo", "hello world"],
    });
    expect(args).toEqual([
      "--yes", "--min-release-age=0", "-p", "@hexclave/cli@2.8.110", "stack",
      "dev", "--flag=a b", "--", "echo", "hello world",
    ]);
  });

  it("uses npx.cmd and requests a shell on Windows (needed to spawn a .cmd post-CVE-2024-27980)", () => {
    const spy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    try {
      const invocation = buildNpxInvocation({
        packageName: "@hexclave/cli", version: "1.0.0", binName: "stack", forwardArgs: [],
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
        packageName: "@hexclave/cli", version: "1.0.0", binName: "stack", forwardArgs: [],
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
    expect(decideReexec({ env: { CI: "true" }, pkg, latest: "9.9.9", forwardArgs: [] }))
      .toEqual({ reexec: false, reason: "disabled" });
  });

  it("does not re-exec when own package is unresolvable", () => {
    expect(decideReexec({ env: {}, pkg: null, latest: "9.9.9", forwardArgs: [] }))
      .toEqual({ reexec: false, reason: "no-package" });
  });

  it("does not re-exec when the registry returned nothing", () => {
    expect(decideReexec({ env: {}, pkg, latest: null, forwardArgs: [] }))
      .toEqual({ reexec: false, reason: "no-latest" });
  });

  it("does not re-exec when latest is not strictly newer", () => {
    expect(decideReexec({ env: {}, pkg, latest: "2.8.109", forwardArgs: ["dev"] }))
      .toEqual({ reexec: false, reason: "not-newer" });
    expect(decideReexec({ env: {}, pkg, latest: "2.8.108", forwardArgs: ["dev"] }))
      .toEqual({ reexec: false, reason: "not-newer" });
  });

  it("re-execs with a pinned npx invocation when a newer version exists", () => {
    const decision = decideReexec({
      env: {},
      pkg,
      latest: "2.8.110",
      forwardArgs: ["dev", "--config-file", "x"],
    });
    expect(decision.reexec).toBe(true);
    if (decision.reexec) {
      expect(decision.invocation.args).toEqual([
        "--yes", "--min-release-age=0", "-p", "@hexclave/cli@2.8.110", "stack", "dev", "--config-file", "x",
      ]);
    }
  });
});

describe("resolveLatestVersion", () => {
  // The latest-version cache is persisted via dev-env-state, which honors
  // STACK_DEV_ENVS_PATH — point it at a temp file so each test is isolated.
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "self-update-"));
    process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
  });

  afterEach(() => {
    delete process.env.STACK_DEV_ENVS_PATH;
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches and caches the latest version", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "2.0.0" }) });
    vi.stubGlobal("fetch", fetchMock);

    const first = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    expect(first).toBe("2.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Within TTL: served from cache, no second network call.
    const second = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 5_000 });
    expect(second).toBe("2.0.0");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cache is stale", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.0.0" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.1.0" }) });
    vi.stubGlobal("fetch", fetchMock);

    await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    const fresh = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 20_000 });
    expect(fresh).toBe("2.1.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a cache entry for a different package", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.0.0" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "9.9.9" }) });
    vi.stubGlobal("fetch", fetchMock);

    await resolveLatestVersion("@stackframe/stack-cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    const other = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 2_000 });
    expect(other).toBe("9.9.9");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null and does not cache when the registry is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    expect(result).toBeNull();

    // A subsequent successful fetch should still happen (nothing was cached).
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.0.0" }) });
    const retry = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 2_000 });
    expect(retry).toBe("2.0.0");
  });

  it("returns null on a non-OK registry response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    expect(result).toBeNull();
  });

  it("re-fetches when the cache age exactly equals the TTL (boundary is exclusive)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.0.0" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.1.0" }) });
    vi.stubGlobal("fetch", fetchMock);

    await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    // now - checkedAt === ttlMs exactly → not "< ttl" → re-fetch.
    const atBoundary = await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 11_000 });
    expect(atBoundary).toBe("2.1.0");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null on an OK response whose body is missing `version`", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: "@hexclave/cli" }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 })).toBeNull();
  });

  it("returns null (and does not cache) when `version` is not a string", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 123 }) });
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 })).toBeNull();

    // Nothing cached → a later good fetch still succeeds.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ version: "2.0.0" }) });
    expect(await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 2_000 })).toBe("2.0.0");
  });

  it("requests the percent-encoded scoped `/latest` URL on the default registry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "2.0.0" }) });
    vi.stubGlobal("fetch", fetchMock);
    await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@hexclave%2fcli/latest",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("uses npm_config_registry (with trailing slashes stripped) for the lookup URL", async () => {
    const prev = process.env.npm_config_registry;
    process.env.npm_config_registry = "https://npm.internal.example.com///";
    try {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "2.0.0" }) });
      vi.stubGlobal("fetch", fetchMock);
      await resolveLatestVersion("@hexclave/cli", { timeoutMs: 1000, ttlMs: 10_000, now: 1_000 });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://npm.internal.example.com/@hexclave%2fcli/latest",
        expect.anything(),
      );
    } finally {
      if (prev == null) delete process.env.npm_config_registry;
      else process.env.npm_config_registry = prev;
    }
  });
});

describe("maybeReexecToLatest", () => {
  let tempDir: string;
  const optOutKeys = ["CI", SKIP_AUTO_UPDATE_ENV, DISABLE_AUTO_UPDATE_ENV];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "reexec-"));
    process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
    // Auto-update must be eligible for the throwing path to be reached.
    for (const key of optOutKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    delete process.env.STACK_DEV_ENVS_PATH;
    for (const key of optOutKeys) {
      if (savedEnv[key] == null) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails open (does not throw) when reading dev-env state throws", async () => {
    // A corrupt state file makes readDevEnvState throw while resolving the
    // cached latest version. The contract is to fall through to the installed
    // CLI, not crash `stack dev`.
    writeFileSync(process.env.STACK_DEV_ENVS_PATH as string, "{ not json", { mode: 0o600 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(maybeReexecToLatest({ forwardArgs: ["dev"] })).resolves.toBeUndefined();
    // It bails on the state-read error before reaching the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
