import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNpxInvocation,
  DISABLE_AUTO_UPDATE_ENV,
  isEnvFlagEnabled,
  isVersionNewer,
  resolveLatestVersion,
  shouldAutoUpdate,
  SKIP_AUTO_UPDATE_ENV,
} from "./self-update.js";

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
});
