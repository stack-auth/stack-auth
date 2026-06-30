import { createHash, randomBytes } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import extractZip from "extract-zip";
import { devEnvStatePath } from "./dev-env-state.js";
import { CliError, errorMessage } from "./errors.js";

// The RDE dashboard ships as a zipped standalone build attached to a GitHub
// Release rather than bundled in the CLI tarball; `hexclave dev` fetches the
// newest one at runtime and caches it. Publishing side: dashboard-release.yaml.

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
};

export type ResolvedDashboard = {
  root: string,
  version: string,
};

function logDashboard(message: string): void {
  console.warn(`${LOG_PREFIX}${message}`);
}

export function parseDashboardManifest(raw: unknown): DashboardManifest | null {
  if (raw == null || typeof raw !== "object") return null;
  const manifest = raw as Record<string, unknown>;
  if (typeof manifest.version !== "string" || !SAFE_VERSION_REGEX.test(manifest.version)) return null;
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.sha256)) return null;
  if (typeof manifest.url !== "string" || !isAllowedDownloadUrl(manifest.url)) return null;
  return { version: manifest.version, sha256: manifest.sha256.toLowerCase(), url: manifest.url };
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

export function dashboardVersionDir(version: string): string {
  return join(dashboardCacheRoot(), version);
}

export function isDashboardCached(version: string): boolean {
  const dir = dashboardVersionDir(version);
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

export function latestCachedDashboardVersion(): string | undefined {
  const root = dashboardCacheRoot();
  if (!existsSync(root)) return undefined;
  const cached = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isDashboardCached(entry.name))
    .map((entry) => entry.name);
  return pickLatestVersion(cached);
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

async function downloadDashboardRelease(manifest: DashboardManifest): Promise<void> {
  const cacheRoot = dashboardCacheRoot();
  mkdirSync(cacheRoot, { recursive: true });
  // Unique temp names so parallel runs don't collide; publish is an atomic rename.
  const suffix = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const tmpZip = join(cacheRoot, `.download-${manifest.version}-${suffix}.zip`);
  const tmpDir = join(cacheRoot, `.extract-${manifest.version}-${suffix}`);
  const targetDir = dashboardVersionDir(manifest.version);
  try {
    const response = await fetch(manifest.url, { redirect: "follow", signal: AbortSignal.timeout(DASHBOARD_DOWNLOAD_TIMEOUT_MS) });
    // The manifest URL passed isAllowedDownloadUrl, but redirects can land on a
    // different host/scheme; re-check the final URL before streaming the archive.
    if (!isAllowedDownloadUrl(response.url)) {
      throw new CliError(`Dashboard ${manifest.version} download was redirected to a disallowed URL (${response.url}).`);
    }
    if (!response.ok || response.body == null) {
      throw new CliError(`Failed to download dashboard ${manifest.version} (HTTP ${response.status}) from ${manifest.url}.`);
    }
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmpZip));

    const digest = await sha256File(tmpZip);
    if (digest !== manifest.sha256) {
      throw new CliError(`Dashboard ${manifest.version} failed its integrity check (expected ${manifest.sha256}, got ${digest}).`);
    }

    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    await extractZip(tmpZip, { dir: tmpDir });
    if (!existsSync(join(tmpDir, DASHBOARD_SERVER_RELATIVE_PATH))) {
      throw new CliError(`Dashboard ${manifest.version} archive is missing its server entrypoint.`);
    }
    writeFileSync(join(tmpDir, DASHBOARD_COMPLETE_MARKER), `${manifest.sha256}\n`);

    // Publish atomically, never rmSync-ing a *valid* targetDir — a concurrent
    // `hexclave dev` may be reading it. The marker is written before the rename,
    // so any fully-published dir passes isDashboardCached.
    if (isDashboardCached(manifest.version)) {
      return;
    }
    try {
      renameSync(tmpDir, targetDir);
    } catch {
      if (isDashboardCached(manifest.version)) {
        return;
      }
      // targetDir exists but isn't valid — an interrupted publish left a partial
      // dir (never the live concurrent-publisher case, handled above). No reader
      // uses a marker-less entry, so replacing it is safe.
      rmSync(targetDir, { recursive: true, force: true });
      renameSync(tmpDir, targetDir);
    }
  } finally {
    rmSync(tmpZip, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Resolve the build to launch: on-disk override → manifest version (downloaded if
// not cached) → newest cached (offline). Throws only when nothing is usable.
export async function resolveDashboardRuntime(opts: { manifest?: DashboardManifest | null } = {}): Promise<ResolvedDashboard> {
  const override = dashboardDirOverride();
  if (override != null) {
    if (!existsSync(join(override, DASHBOARD_SERVER_RELATIVE_PATH))) {
      throw new CliError(`${DASHBOARD_DIR_OVERRIDE_ENV_VAR} is set to ${override}, but no dashboard server was found there.`);
    }
    return { root: override, version: "local" };
  }

  const manifest = opts.manifest !== undefined ? opts.manifest : await fetchDashboardManifest();
  if (manifest != null) {
    if (isDashboardCached(manifest.version)) {
      return { root: dashboardVersionDir(manifest.version), version: manifest.version };
    }
    try {
      await downloadDashboardRelease(manifest);
      return { root: dashboardVersionDir(manifest.version), version: manifest.version };
    } catch (error) {
      const cached = latestCachedDashboardVersion();
      if (cached != null) {
        logDashboard(`Failed to download dashboard ${manifest.version} (${errorMessage(error)}); using cached ${cached}.`);
        return { root: dashboardVersionDir(cached), version: cached };
      }
      throw error;
    }
  }

  const cached = latestCachedDashboardVersion();
  if (cached != null) {
    logDashboard(`Offline: using cached Hexclave dashboard ${cached}.`);
    return { root: dashboardVersionDir(cached), version: cached };
  }

  throw new CliError([
    "Could not download the Hexclave development-environment dashboard and no cached copy is available.",
    `Check your network connection, or set ${DASHBOARD_DIR_OVERRIDE_ENV_VAR} to a local dashboard build.`,
  ].join(" "));
}
