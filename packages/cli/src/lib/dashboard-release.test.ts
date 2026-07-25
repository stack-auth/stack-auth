import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DASHBOARD_DIR_OVERRIDE_ENV_VAR,
  DASHBOARD_MANIFEST_CACHE_TTL_MS,
  DASHBOARD_MANIFEST_URL_ENV_VAR,
  dashboardDirOverride,
  dashboardManifestUrl,
  fetchDashboardManifestCached,
  parseDashboardManifest,
  pickLatestVersion,
} from "./dashboard-release.js";
import { readDevEnvState, writeDevEnvState } from "./dev-env-state.js";

const VALID_SHA = "a".repeat(64);
const MANIFEST_URL = "https://mirror.example/manifest.json";
const VALID_MANIFEST = {
  version: "1.2.3",
  sha256: VALID_SHA,
  url: "https://example.com/dashboard-1.2.3.zip",
};

let tempDir: string | undefined;

function useTempStateFile() {
  tempDir = mkdtempSync(join(tmpdir(), "hexclave-dashboard-release-"));
  process.env.STACK_DEV_ENVS_PATH = join(tempDir, "dev-envs.json");
}

afterEach(() => {
  delete process.env.STACK_DEV_ENVS_PATH;
  vi.restoreAllMocks();
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("parseDashboardManifest", () => {
  it("accepts a well-formed manifest and lowercases the digest", () => {
    expect(parseDashboardManifest({
      version: "1.2.3",
      sha256: VALID_SHA.toUpperCase(),
      url: "https://example.com/dashboard-1.2.3.zip",
    })).toEqual({
      version: "1.2.3",
      sha256: VALID_SHA,
      url: "https://example.com/dashboard-1.2.3.zip",
    });
  });

  it("rejects missing or empty fields", () => {
    expect(parseDashboardManifest(null)).toBeNull();
    expect(parseDashboardManifest("nope")).toBeNull();
    expect(parseDashboardManifest({ sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "", sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "1.2.3", sha256: VALID_SHA, url: "" })).toBeNull();
  });

  it("rejects a non-hex, wrong-length, or padded sha256", () => {
    expect(parseDashboardManifest({ version: "1.2.3", sha256: "abc", url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "1.2.3", sha256: "z".repeat(64), url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "1.2.3", sha256: "a".repeat(63), url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "1.2.3", sha256: `${VALID_SHA} `, url: "https://x/y.zip" })).toBeNull();
  });

  it("accepts a v-prefix and a prerelease/build version", () => {
    expect(parseDashboardManifest({ version: "v1.2.3", sha256: VALID_SHA, url: "https://x/y.zip" })?.version).toBe("v1.2.3");
    expect(parseDashboardManifest({ version: "1.2.3-beta.1", sha256: VALID_SHA, url: "https://x/y.zip" })?.version).toBe("1.2.3-beta.1");
  });

  it("requires https for the url, allowing http only for loopback", () => {
    const ok = (url: string) => parseDashboardManifest({ version: "1.2.3", sha256: VALID_SHA, url })?.url;
    expect(ok("https://example.com/d.zip")).toBe("https://example.com/d.zip");
    expect(ok("http://127.0.0.1:8000/d.zip")).toBe("http://127.0.0.1:8000/d.zip");
    expect(ok("http://localhost:8000/d.zip")).toBe("http://localhost:8000/d.zip");
    expect(ok("http://example.com/d.zip")).toBeUndefined();
    expect(ok("ftp://example.com/d.zip")).toBeUndefined();
    expect(ok("file:///etc/passwd")).toBeUndefined();
    expect(ok("not a url")).toBeUndefined();
  });

  it("rejects a non-string or path-unsafe version", () => {
    expect(parseDashboardManifest({ version: 123, sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "../../etc", sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "1.2", sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "latest", sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
    expect(parseDashboardManifest({ version: "1.2.3/../x", sha256: VALID_SHA, url: "https://x/y.zip" })).toBeNull();
  });
});

describe("dashboardDirOverride", () => {
  it("returns the trimmed override when set", () => {
    expect(dashboardDirOverride({ [DASHBOARD_DIR_OVERRIDE_ENV_VAR]: "  /tmp/dash  " })).toBe("/tmp/dash");
  });

  it("returns undefined when unset or blank", () => {
    expect(dashboardDirOverride({})).toBeUndefined();
    expect(dashboardDirOverride({ [DASHBOARD_DIR_OVERRIDE_ENV_VAR]: "   " })).toBeUndefined();
  });
});

describe("dashboardManifestUrl", () => {
  it("defaults to the dashboard-latest release manifest", () => {
    expect(dashboardManifestUrl({})).toBe(
      "https://github.com/hexclave/hexclave/releases/download/dashboard-latest/manifest.json",
    );
  });

  it("honors the override env var, trimming whitespace", () => {
    expect(dashboardManifestUrl({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: "  https://mirror/manifest.json  " }))
      .toBe("https://mirror/manifest.json");
  });

  it("falls back to the default for a blank override", () => {
    expect(dashboardManifestUrl({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: "   " }))
      .toBe("https://github.com/hexclave/hexclave/releases/download/dashboard-latest/manifest.json");
  });
});

describe("fetchDashboardManifestCached", () => {
  it("returns a fresh cached entry without making a network request", async () => {
    useTempStateFile();
    writeDevEnvState({
      version: 1,
      dashboardManifestsByUrl: {
        [MANIFEST_URL]: {
          manifest: VALID_MANIFEST,
          fetchedAtMillis: Date.now(),
        },
      },
      projectsByConfigPath: {},
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboardManifestCached({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: MANIFEST_URL }))
      .resolves.toEqual(VALID_MANIFEST);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches and persists a missing manifest cache entry", async () => {
    useTempStateFile();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID_MANIFEST), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboardManifestCached({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: MANIFEST_URL }))
      .resolves.toEqual(VALID_MANIFEST);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readDevEnvState().dashboardManifestsByUrl?.[MANIFEST_URL]?.manifest).toEqual(VALID_MANIFEST);
    expect(readDevEnvState().dashboardManifestsByUrl?.[MANIFEST_URL]?.fetchedAtMillis).toBeTypeOf("number");
  });

  it("fetches and replaces an expired cache entry", async () => {
    useTempStateFile();
    writeDevEnvState({
      version: 1,
      dashboardManifestsByUrl: {
        [MANIFEST_URL]: {
          manifest: { ...VALID_MANIFEST, version: "1.2.2" },
          fetchedAtMillis: Date.now() - DASHBOARD_MANIFEST_CACHE_TTL_MS - 1,
        },
      },
      projectsByConfigPath: {},
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID_MANIFEST), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboardManifestCached({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: MANIFEST_URL }))
      .resolves.toEqual(VALID_MANIFEST);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readDevEnvState().dashboardManifestsByUrl?.[MANIFEST_URL]?.manifest).toEqual(VALID_MANIFEST);
  });

  it("keys cache entries by manifest URL", async () => {
    useTempStateFile();
    const otherManifestUrl = "https://other.example/manifest.json";
    writeDevEnvState({
      version: 1,
      dashboardManifestsByUrl: {
        [MANIFEST_URL]: {
          manifest: VALID_MANIFEST,
          fetchedAtMillis: Date.now(),
        },
      },
      projectsByConfigPath: {},
    });
    const otherManifest = { ...VALID_MANIFEST, version: "1.2.4" };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(otherManifest), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboardManifestCached({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: otherManifestUrl }))
      .resolves.toEqual(otherManifest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readDevEnvState().dashboardManifestsByUrl?.[otherManifestUrl]?.manifest).toEqual(otherManifest);
  });

  it("ignores malformed persisted entries and replaces them after a successful fetch", async () => {
    useTempStateFile();
    const statePath = process.env.STACK_DEV_ENVS_PATH;
    if (statePath == null) {
      throw new Error("STACK_DEV_ENVS_PATH should be set by useTempStateFile().");
    }
    writeFileSync(statePath, JSON.stringify({
      version: 1,
      dashboardManifestsByUrl: {
        [MANIFEST_URL]: {
          manifest: { ...VALID_MANIFEST, sha256: "not-a-digest" },
          fetchedAtMillis: Date.now(),
        },
      },
      projectsByConfigPath: {},
    }), { mode: 0o600 });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID_MANIFEST), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchDashboardManifestCached({ [DASHBOARD_MANIFEST_URL_ENV_VAR]: MANIFEST_URL }))
      .resolves.toEqual(VALID_MANIFEST);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(statePath, "utf-8")).dashboardManifestsByUrl[MANIFEST_URL].manifest)
      .toEqual(VALID_MANIFEST);
  });
});

describe("pickLatestVersion", () => {
  it("returns the highest semver", () => {
    expect(pickLatestVersion(["1.0.37", "1.0.9", "1.1.0", "0.9.99"])).toBe("1.1.0");
  });

  it("ignores unparseable entries", () => {
    expect(pickLatestVersion([".extract-tmp", "1.0.5", "garbage", "1.0.10"])).toBe("1.0.10");
  });

  it("prefers a final release over a same-core prerelease regardless of order", () => {
    expect(pickLatestVersion(["1.2.3-beta.1", "1.2.3"])).toBe("1.2.3");
    expect(pickLatestVersion(["1.2.3", "1.2.3-beta.1"])).toBe("1.2.3");
    // `+build` metadata is not a prerelease, so it still outranks a same-core prerelease.
    expect(pickLatestVersion(["1.2.3-rc.1", "1.2.3+build"])).toBe("1.2.3+build");
    expect(pickLatestVersion(["1.2.3+build", "1.2.3-rc.1"])).toBe("1.2.3+build");
  });

  it("returns undefined when nothing parses", () => {
    expect(pickLatestVersion([])).toBeUndefined();
    expect(pickLatestVersion([".tmp", "latest"])).toBeUndefined();
  });
});
