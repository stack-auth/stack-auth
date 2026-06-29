import { createHash, randomBytes } from "crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import extractZip from "extract-zip";
import { devEnvStatePath } from "./dev-env-state.js";
import { CliError, errorMessage } from "./errors.js";

// The RDE dashboard is published as a standalone Next.js build, zipped and
// attached to a GitHub Release, instead of being bundled into the CLI npm
// tarball. `hexclave dev` fetches the newest published dashboard at runtime and
// caches it on disk, so a fresh dashboard rolls out without reinstalling the
// CLI (and without npm/npx shipping a ~165 MB tarball that trips download
// firewalls). See dashboard-release.yaml for the publishing side.

// Repo that hosts the dashboard releases. Matches package.json "repository".
const DASHBOARD_REPO = "hexclave/hexclave";
// A continuously-updated release whose `manifest.json` asset always points at
// the newest dashboard build. A stable GitHub download URL — no API call, so no
// unauthenticated rate limit, and it follows the standard redirect to the
// release CDN.
const DASHBOARD_LATEST_MANIFEST_URL = `https://github.com/${DASHBOARD_REPO}/releases/download/dashboard-latest/manifest.json`;

// Point the CLI at a different manifest (self-hosted mirror, staging, tests).
export const DASHBOARD_MANIFEST_URL_ENV_VAR = "HEXCLAVE_DASHBOARD_MANIFEST_URL";
// Run a local dashboard build straight from disk, skipping all networking. The
// directory must contain apps/dashboard/server.js (a copy-runtime-assets output).
export const DASHBOARD_DIR_OVERRIDE_ENV_VAR = "HEXCLAVE_DASHBOARD_DIR";

// Server entrypoint inside an extracted dashboard build.
export const DASHBOARD_SERVER_RELATIVE_PATH = join("apps", "dashboard", "server.js");

const DASHBOARD_CACHE_DIR_NAME = "dashboards";
// Written only after an extraction completes, so a half-extracted directory is
// never treated as a usable cache entry.
const DASHBOARD_COMPLETE_MARKER = ".hexclave-complete";
const LOG_PREFIX = "[Hexclave] ";
// `version` is interpolated into cache paths and the manifest is untrusted when
// HEXCLAVE_DASHBOARD_MANIFEST_URL points at a non-default host, so restrict it to
// a path-safe semver shape (no separators, can't start with "..").
const SAFE_VERSION_REGEX = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;
// Give up rather than hang forever when a slow/dead host stalls a fetch. The
// manifest is tiny; the zip is large, so it gets a much longer budget. A timeout
// surfaces as a normal fetch error → offline-cache fallback.
const MANIFEST_FETCH_TIMEOUT_MS = 10_000;
const DASHBOARD_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

// The dashboard build is public and integrity-checked, but require https for the
// download URL so a custom manifest can't quietly pull it over plaintext —
// except loopback, which keeps local testing/mirrors (e.g. a `python -m
// http.server` on 127.0.0.1) working. Also rejects non-http(s) schemes.
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

// Validate an untrusted manifest fetched over the network. A bad/empty sha256
// would let a corrupt download through, so the digest must be a 64-char hex; the
// version must be a path-safe semver (see SAFE_VERSION_REGEX) since it becomes a
// cache directory name.
export function parseDashboardManifest(raw: unknown): DashboardManifest | null {
  if (raw == null || typeof raw !== "object") return null;
  const manifest = raw as Record<string, unknown>;
  if (typeof manifest.version !== "string" || !SAFE_VERSION_REGEX.test(manifest.version)) return null;
  if (typeof manifest.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(manifest.sha256)) return null;
  if (typeof manifest.url !== "string" || !isAllowedDownloadUrl(manifest.url)) return null;
  return { version: manifest.version, sha256: manifest.sha256.toLowerCase(), url: manifest.url };
}

// The local-build override, if set. When present the CLI runs this dashboard
// directly and never touches the network (no manifest fetch, no download).
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

type ParsedVersion = [number, number, number];

// NB: dev.ts has its own parseVersionCore/isVersionNewer that additionally
// tracks prerelease ordering for the dashboard-restart decision. This copy only
// ranks already-published cache directory names, so it deliberately ignores
// prereleases. Kept separate on purpose — don't merge them.
function parseVersionCore(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Pick the highest semver from a list, ignoring unparseable entries. Pure, so
// the offline-fallback selection can be unit-tested. Returns undefined when no
// entry parses as a version.
export function pickLatestVersion(versions: string[]): string | undefined {
  let best: { version: string, core: ParsedVersion } | undefined;
  for (const version of versions) {
    const core = parseVersionCore(version);
    if (core == null) continue;
    if (best == null || isCoreNewer(core, best.core)) {
      best = { version, core };
    }
  }
  return best?.version;
}

function isCoreNewer(candidate: ParsedVersion, current: ParsedVersion): boolean {
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

// Newest fully-extracted dashboard already on disk, used as an offline fallback
// when the manifest can't be fetched.
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
  // Unique temp names so parallel `hexclave dev` invocations don't clobber each
  // other; the final publish into the version dir is an atomic rename.
  const suffix = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const tmpZip = join(cacheRoot, `.download-${manifest.version}-${suffix}.zip`);
  const tmpDir = join(cacheRoot, `.extract-${manifest.version}-${suffix}`);
  const targetDir = dashboardVersionDir(manifest.version);
  try {
    const response = await fetch(manifest.url, { redirect: "follow", signal: AbortSignal.timeout(DASHBOARD_DOWNLOAD_TIMEOUT_MS) });
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

    // Publish atomically, never rmSync-ing a *valid* targetDir (a concurrent
    // `hexclave dev` may be copying from it right now). The completion marker is
    // written into tmpDir above before the rename, so any fully-published
    // targetDir already passes isDashboardCached.
    if (isDashboardCached(manifest.version)) {
      // Another process published this version while we downloaded — discard ours.
      return;
    }
    try {
      // Atomic when targetDir doesn't exist.
      renameSync(tmpDir, targetDir);
    } catch {
      if (isDashboardCached(manifest.version)) {
        // A concurrent publisher won the race; its entry is valid, so keep it.
        return;
      }
      // targetDir exists but isn't a valid cache entry — i.e. an interrupted
      // publish left a partial dir. No reader ever uses a partial entry (it
      // lacks the marker), so replacing it is safe. This branch does NOT handle a
      // live concurrent publisher; that case returned just above.
      rmSync(targetDir, { recursive: true, force: true });
      renameSync(tmpDir, targetDir);
    }
  } finally {
    rmSync(tmpZip, { force: true });
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Resolve the dashboard build `hexclave dev` should launch, downloading and
// caching it when necessary. Precedence: explicit on-disk override, then the
// version named by `manifest` (fetched if not supplied), then — when the network
// is unavailable — the newest already-cached build. Throws only when there is no
// usable dashboard anywhere.
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
