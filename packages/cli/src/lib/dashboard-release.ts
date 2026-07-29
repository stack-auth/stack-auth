import { createHash, randomBytes } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import * as zlib from "node:zlib";
import * as tar from "tar";
import extractZip from "extract-zip";
import { devEnvStatePath } from "./dev-env-state.js";
import { CliError, errorMessage } from "./errors.js";

// The development-environment dashboard ships as standalone archives attached
// to a GitHub Release rather than bundled in the CLI tarball; `hexclave dev`
// fetches the newest one at runtime and caches it. Publishing side:
// dashboard-release.yaml.

const DASHBOARD_REPO = "hexclave/hexclave";
// Floating manifest pointing at the newest build — a stable download URL (no API
// call, so no rate limit).
const DASHBOARD_LATEST_MANIFEST_URL = `https://github.com/${DASHBOARD_REPO}/releases/download/dashboard-latest/manifest.json`;

// Point the CLI at a different manifest (mirror/staging/tests).
export const DASHBOARD_MANIFEST_URL_ENV_VAR = "HEXCLAVE_DASHBOARD_MANIFEST_URL";
// Run a local on-disk build, skipping all networking.
export const DASHBOARD_DIR_OVERRIDE_ENV_VAR = "HEXCLAVE_DASHBOARD_DIR";

export const DASHBOARD_SERVER_RELATIVE_PATH = join("apps", "dashboard", "server.js");

const DASHBOARD_CACHE_DIR_NAME = "dashboards";
// Written only after extraction completes, so a half-extracted dir is never used.
const DASHBOARD_COMPLETE_MARKER = ".hexclave-complete";
const LOG_PREFIX = "[Hexclave] ";
// `version` becomes a cache dir name and the manifest is untrusted, so require a
// path-safe semver.
const SAFE_VERSION_REGEX = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
// Don't hang forever on a slow host; a timeout falls through to the offline cache.
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const DASHBOARD_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

// Require https for the download (loopback http allowed for local mirrors/tests);
// also rejects non-http(s) schemes.
function isAllowedDownloadUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol === "http:") {
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  }
  return false;
}

export type DashboardManifest = {
  version: string,
  sha256: string,
  url: string,
  platformArchives?: Record<string, DashboardPlatformArchive>,
};

export type DashboardPlatformArchive = {
  sha256: string,
  url: string,
};

export type ResolvedDashboard = {
  root: string,
  version: string,
};

export const DASHBOARD_PLATFORM_KEYS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;
export type DashboardPlatformKey = (typeof DASHBOARD_PLATFORM_KEYS)[number];

function logDashboard(message: string): void {
  console.warn(`${LOG_PREFIX}${message}`);
}

export function parseDashboardManifest(raw: unknown): DashboardManifest | null {
  if (!isRecord(raw)) return null;
  const manifest = raw;
  if (typeof manifest.version !== "string" || !SAFE_VERSION_REGEX.test(manifest.version)) return null;
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.sha256)) return null;
  if (typeof manifest.url !== "string" || !isAllowedDownloadUrl(manifest.url)) return null;
  let platformArchives: Record<string, DashboardPlatformArchive> | undefined;
  if (manifest.platformArchives != null) {
    if (!isRecord(manifest.platformArchives)) {
      return { version: manifest.version, sha256: manifest.sha256.toLowerCase(), url: manifest.url };
    }
    const validPlatformArchives: Record<string, DashboardPlatformArchive> = {};
    for (const [platform, value] of Object.entries(manifest.platformArchives)) {
      if (!DASHBOARD_PLATFORM_KEYS.some((supportedKey) => supportedKey === platform)) continue;
      if (!isRecord(value)) continue;
      const archive = value;
      if (
        typeof archive.sha256 !== "string"
        || !/^[0-9a-f]{64}$/i.test(archive.sha256)
        || typeof archive.url !== "string"
        || !isAllowedDownloadUrl(archive.url)
      ) {
        continue;
      }
      validPlatformArchives[platform] = {
        sha256: archive.sha256.toLowerCase(),
        url: archive.url,
      };
    }
    if (Object.keys(validPlatformArchives).length > 0) platformArchives = validPlatformArchives;
  }
  return {
    version: manifest.version,
    sha256: manifest.sha256.toLowerCase(),
    url: manifest.url,
    ...(platformArchives == null ? {} : { platformArchives }),
  };
}

export function dashboardPlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): DashboardPlatformKey | undefined {
  const key = `${platform}-${arch}`;
  return DASHBOARD_PLATFORM_KEYS.find((supportedKey) => supportedKey === key);
}

type ZstdCapability = {
  createZstdCompress?: unknown,
  createZstdDecompress?: unknown,
};

export function hasZstdSupport(zlibModule: ZstdCapability = zlib): boolean {
  return typeof zlibModule.createZstdCompress === "function" && typeof zlibModule.createZstdDecompress === "function";
}

export function selectDashboardArchive(
  manifest: DashboardManifest,
  platformKey = dashboardPlatformKey(),
  zstdAvailable = hasZstdSupport(),
): { sha256: string, url: string, cacheSuffix?: DashboardPlatformKey } {
  const platformArchive = !zstdAvailable || platformKey == null ? undefined : manifest.platformArchives?.[platformKey];
  return platformArchive == null
    ? { sha256: manifest.sha256, url: manifest.url }
    : { ...platformArchive, cacheSuffix: platformKey };
}

export function dashboardDirOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env[DASHBOARD_DIR_OVERRIDE_ENV_VAR]?.trim();
  return override != null && override.length > 0 ? override : undefined;
}

export function dashboardManifestUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DASHBOARD_MANIFEST_URL_ENV_VAR]?.trim();
  return override != null && override.length > 0 ? override : DASHBOARD_LATEST_MANIFEST_URL;
}

export function dashboardCacheRoot(): string {
  return join(dirname(devEnvStatePath()), DASHBOARD_CACHE_DIR_NAME);
}

export function dashboardVersionDir(version: string, cacheSuffix?: DashboardPlatformKey): string {
  return join(dashboardCacheRoot(), cacheSuffix == null ? version : `${version}--${cacheSuffix}`);
}

export function isDashboardCached(
  version: string,
  cacheSuffix?: DashboardPlatformKey,
  cacheRoot: string = dashboardCacheRoot(),
): boolean {
  const dir = join(cacheRoot, cacheSuffix == null ? version : `${version}--${cacheSuffix}`);
  return existsSync(join(dir, DASHBOARD_COMPLETE_MARKER)) && existsSync(join(dir, DASHBOARD_SERVER_RELATIVE_PATH));
}

type ParsedVersion = {
  core: [number, number, number],
  // A `-suffix` after the core marks a prerelease (1.2.3-rc.1); `+build`
  // metadata does not. A final release outranks a prerelease of the same core.
  hasPrerelease: boolean,
};

// Uses the same "final release beats a same-core prerelease" rule as dev.ts's
// isVersionNewer, but kept separate: that one takes raw version strings for the
// restart check, while this ranks already-parsed cached dir names. Neither
// orders two distinct same-core prereleases against each other.
function parseVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version.trim());
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], hasPrerelease: match[4].startsWith("-") };
}

export function pickLatestVersion(versions: string[]): string | undefined {
  let best: { version: string, parsed: ParsedVersion } | undefined;
  for (const version of versions) {
    const parsed = parseVersion(version);
    if (parsed == null) continue;
    if (best == null || isVersionNewer(parsed, best.parsed)) {
      best = { version, parsed };
    }
  }
  return best?.version;
}

function isVersionNewer(candidate: ParsedVersion, current: ParsedVersion): boolean {
  for (let i = 0; i < 3; i++) {
    if (candidate.core[i] !== current.core[i]) return candidate.core[i] > current.core[i];
  }
  // Same core: prefer the final release over a prerelease so the offline pick is
  // deterministic regardless of directory order (1.2.3 beats 1.2.3-rc.1).
  if (candidate.hasPrerelease !== current.hasPrerelease) return !candidate.hasPrerelease;
  return false;
}

export function latestCachedDashboard(
  platformKey?: DashboardPlatformKey,
  cacheRoot: string = dashboardCacheRoot(),
): { version: string, root: string } | undefined {
  if (!existsSync(cacheRoot)) return undefined;
  const suffix = platformKey == null ? "" : `--${platformKey}`;
  const cached = readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => (
      entry.isDirectory()
      && (platformKey == null
        ? !DASHBOARD_PLATFORM_KEYS.some((supportedKey) => entry.name.endsWith(`--${supportedKey}`))
        : entry.name.endsWith(suffix))
    ))
    .map((entry) => {
      const version = suffix.length === 0 ? entry.name : entry.name.slice(0, -suffix.length);
      const root = join(cacheRoot, platformKey == null ? version : `${version}--${platformKey}`);
      return isDashboardCached(version, platformKey, cacheRoot)
        ? { version, root }
        : undefined;
    })
    .filter((entry): entry is { version: string, root: string } => entry != null);
  const version = pickLatestVersion(cached.map((entry) => entry.version));
  return version == null ? undefined : cached.find((entry) => entry.version === version);
}

export async function fetchDashboardManifest(env: NodeJS.ProcessEnv = process.env): Promise<DashboardManifest | null> {
  const url = dashboardManifestUrl(env);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS) });
    if (!response.ok) {
      logDashboard(`Could not fetch dashboard manifest (HTTP ${response.status}) from ${url}.`);
      return null;
    }
    return parseDashboardManifest(await response.json());
  } catch (error) {
    logDashboard(`Could not fetch dashboard manifest from ${url}: ${errorMessage(error)}`);
    return null;
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function downloadDashboardRelease(
  manifest: DashboardManifest,
  archive: { sha256: string, url: string, cacheSuffix?: DashboardPlatformKey },
  onProgress?: (message: string) => void,
): Promise<void> {
  const cacheRoot = dashboardCacheRoot();
  mkdirSync(cacheRoot, { recursive: true });
  // Unique temp names so parallel runs don't collide; publish is an atomic rename.
  const suffix = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const tmpArchive = join(
    cacheRoot,
    `.download-${manifest.version}-${suffix}${archive.cacheSuffix == null ? ".zip" : ".tar.zst"}`,
  );
  const tmpDir = join(cacheRoot, `.extract-${manifest.version}-${suffix}`);
  const targetDir = dashboardVersionDir(manifest.version, archive.cacheSuffix);
  try {
    onProgress?.(`Downloading Hexclave dashboard ${manifest.version}`);
    const response = await fetch(archive.url, { redirect: "follow", signal: AbortSignal.timeout(DASHBOARD_DOWNLOAD_TIMEOUT_MS) });
    // The manifest URL passed isAllowedDownloadUrl, but redirects can land on a
    // different host/scheme; re-check the final URL before streaming the archive.
    if (!isAllowedDownloadUrl(response.url)) {
      throw new CliError(`Dashboard ${manifest.version} download was redirected to a disallowed URL (${response.url}).`);
    }
    if (!response.ok || response.body == null) {
      throw new CliError(`Failed to download dashboard ${manifest.version} (HTTP ${response.status}) from ${archive.url}.`);
    }
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmpArchive));

    onProgress?.(`Verifying Hexclave dashboard ${manifest.version}`);
    const digest = await sha256File(tmpArchive);
    if (digest !== archive.sha256) {
      throw new CliError(`Dashboard ${manifest.version} failed its integrity check (expected ${archive.sha256}, got ${digest}).`);
    }

    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    onProgress?.(`Extracting Hexclave dashboard ${manifest.version}`);
    if (archive.cacheSuffix == null) {
      await extractZip(tmpArchive, { dir: tmpDir });
    } else {
      await pipeline(
        createReadStream(tmpArchive),
        zlib.createZstdDecompress(),
        tar.x({ cwd: tmpDir, strict: true, preservePaths: false }),
      );
    }
    if (!existsSync(join(tmpDir, DASHBOARD_SERVER_RELATIVE_PATH))) {
      throw new CliError(`Dashboard ${manifest.version} archive is missing its server entrypoint.`);
    }
    writeFileSync(join(tmpDir, DASHBOARD_COMPLETE_MARKER), `${archive.sha256}\n`);

    // Publish atomically, never rmSync-ing a *valid* targetDir — a concurrent
    // `hexclave dev` may be reading it. The marker is written before the rename,
    // so any fully-published dir passes isDashboardCached.
    if (isDashboardCached(manifest.version, archive.cacheSuffix)) {
      return;
    }
    try {
      renameSync(tmpDir, targetDir);
    } catch {
      if (isDashboardCached(manifest.version, archive.cacheSuffix)) {
        return;
      }
      // targetDir exists but isn't valid — an interrupted publish left a partial
      // dir (never the live concurrent-publisher case, handled above). No reader
      // uses a marker-less entry, so replacing it is safe.
      rmSync(targetDir, { recursive: true, force: true });
      renameSync(tmpDir, targetDir);
    }
  } finally {
    rmSync(tmpArchive, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Resolve the build to launch: on-disk override → manifest version (downloaded if
// not cached) → newest cached (offline). Throws only when nothing is usable.
export async function resolveDashboardRuntime(opts: {
  manifest?: DashboardManifest | null,
  onProgress?: (message: string) => void,
} = {}): Promise<ResolvedDashboard> {
  const override = dashboardDirOverride();
  if (override != null) {
    if (!existsSync(join(override, DASHBOARD_SERVER_RELATIVE_PATH))) {
      throw new CliError(`${DASHBOARD_DIR_OVERRIDE_ENV_VAR} is set to ${override}, but no dashboard server was found there.`);
    }
    return { root: override, version: "local" };
  }

  const manifest = opts.manifest !== undefined ? opts.manifest : await fetchDashboardManifest();
  if (manifest != null) {
    const archive = selectDashboardArchive(manifest);
    if (isDashboardCached(manifest.version, archive.cacheSuffix)) {
      return { root: dashboardVersionDir(manifest.version, archive.cacheSuffix), version: manifest.version };
    }
    try {
      await downloadDashboardRelease(manifest, archive, opts.onProgress);
      return { root: dashboardVersionDir(manifest.version, archive.cacheSuffix), version: manifest.version };
    } catch (error) {
      const cached = latestCachedDashboard(dashboardPlatformKey()) ?? latestCachedDashboard();
      if (cached != null) {
        logDashboard(`Failed to download dashboard ${manifest.version} (${errorMessage(error)}); using cached ${cached.version}.`);
        return cached;
      }
      throw error;
    }
  }

  const cached = latestCachedDashboard(dashboardPlatformKey()) ?? latestCachedDashboard();
  if (cached != null) {
    logDashboard(`Offline: using cached Hexclave dashboard ${cached.version}.`);
    return cached;
  }

  throw new CliError([
    "Could not download the Hexclave development-environment dashboard and no cached copy is available.",
    `Check your network connection, or set ${DASHBOARD_DIR_OVERRIDE_ENV_VAR} to a local dashboard build.`,
  ].join(" "));
}
