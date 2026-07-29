#!/usr/bin/env node
// Packages the standalone RDE dashboard into a GitHub Release artifact: a
// dashboard-<version>.zip plus platform-specific tar.zst archives and a
// manifest.json ({ version, sha256, url, platformArchives }) that
// dashboard-release.ts fetches at runtime. Run by dashboard-release.yaml;
// requires the `zip` CLI (present on ubuntu runners) and the approved `tar`
// package dependency.
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { appendFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import * as zlib from "node:zlib";
import { pipeline } from "stream/promises";
import * as tar from "tar";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");

// Overridable so forks / mirrors can host their own releases.
const repository = process.env.DASHBOARD_RELEASE_REPO ?? "hexclave/hexclave";
// For local testing: point the manifest's asset URL at a static server
// (e.g. http://127.0.0.1:8000) instead of GitHub.
const baseUrlOverride = process.env.DASHBOARD_RELEASE_BASE_URL?.replace(/\/+$/, "");

// Must mirror SAFE_VERSION_REGEX in packages/cli/src/lib/dashboard-release.ts:
// the CLI rejects any manifest whose version fails this pattern, and the version
// becomes a release tag and zip filename, so fail loudly here before publishing
// an artifact every CLI would ignore.
const SAFE_VERSION_REGEX = /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;
const dashboardPackageJson = JSON.parse(readFileSync(join(repoRoot, "apps/dashboard/package.json"), "utf-8"));
const version = dashboardPackageJson.version;
if (typeof version !== "string" || !SAFE_VERSION_REGEX.test(version)) {
  throw new Error(`apps/dashboard/package.json has an invalid version ${JSON.stringify(version)}; expected a path-safe semver matching ${SAFE_VERSION_REGEX}.`);
}

const dashboardDist = join(packageRoot, "dist", "dashboard");
const serverEntry = join(dashboardDist, "apps", "dashboard", "server.js");
const outDir = join(packageRoot, "dashboard-release");
const zipName = `dashboard-${version}.zip`;
const zipPath = join(outDir, zipName);
const manifestPath = join(outDir, "manifest.json");
const platformArchivesDir = join(outDir, "platform");
const tag = `dashboard-v${version}`;
// Level 15 measured at ~75 seconds for all six archives, versus ~168 seconds
// at level 19; it stays under the two-minute packaging budget while saving
// about 3 MB per archive compared with level 10.
const ZSTD_COMPRESSION_LEVEL = 15;

function getAssetUrl(name, subdirectory) {
  const path = subdirectory == null ? name : `${subdirectory}/${name}`;
  if (baseUrlOverride != null && baseUrlOverride.length > 0) {
    // Local mirrors expose the same on-disk subdirectory layout as the package
    // output; GitHub release assets are intentionally flat and ignore it.
    return `${baseUrlOverride}/${path}`;
  }
  return `https://github.com/${repository}/releases/download/${tag}/${name}`;
}

const assetUrl = getAssetUrl(zipName);

function findClaudeSdkPackage(dir) {
  const scopedPackagesDir = join(dir, "apps", "dashboard", ".next", "node_modules", "@anthropic-ai");
  if (!existsSync(scopedPackagesDir)) return undefined;
  for (const entry of readdirSync(scopedPackagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = join(scopedPackagesDir, entry.name);
    const packageJsonPath = join(entryPath, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (packageJson.name === "@anthropic-ai/claude-agent-sdk") return entryPath;
  }
  return undefined;
}

function getVendorInfo(dir) {
  const sdkPackage = findClaudeSdkPackage(dir);
  if (sdkPackage == null) throw new Error(`Could not find the staged Claude Agent SDK under ${dir}.`);
  const vendorDir = join(sdkPackage, "vendor");
  const components = readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (components.length === 0) throw new Error(`The staged Claude Agent SDK has no vendor components under ${vendorDir}.`);
  return { vendorDir, components };
}

function supportedPlatformKeys(vendorInfo) {
  const keys = new Set();
  for (const vendorName of vendorInfo.components) {
    for (const entry of readdirSync(join(vendorInfo.vendorDir, vendorName), { withFileTypes: true })) {
      const match = /^([^/]+)-(darwin|linux|win32)$/.exec(entry.name);
      if (entry.isDirectory() && match != null) keys.add(`${match[2]}-${match[1]}`);
    }
  }
  return [...keys].sort();
}

function createVendorFilter(vendorInfo, platformKey) {
  const [platform, arch] = platformKey.split("-");
  const vendorPlatformKey = `${arch}-${platform}`;
  const selected = new Set();
  const rejected = new Set();
  return {
    filter(path) {
      const match = /\/vendor\/([^/]+)\/([^/]+)(?:\/|$)/.exec(path);
      if (match == null || !vendorInfo.components.includes(match[1])) return true;
      const component = match[1];
      if (match[2] === vendorPlatformKey) {
        selected.add(component);
        return true;
      }
      rejected.add(`${component}/${match[2]}`);
      return false;
    },
    assert() {
      const expected = new Set(vendorInfo.components);
      if (selected.size !== expected.size || [...expected].some((component) => !selected.has(component))) {
        throw new Error(`Platform ${platformKey} selected ${[...selected].join(", ") || "no"} vendor components; expected ${[...expected].join(", ")}.`);
      }
      if (rejected.size === 0) {
        throw new Error(`Platform ${platformKey} did not filter any non-${vendorPlatformKey} vendor directories.`);
      }
    },
  };
}

async function createTarZstd(sourceDir, archivePath, vendorInfo, platformKey) {
  if (typeof zlib.createZstdCompress !== "function") {
    throw new Error("This Node.js runtime does not provide createZstdCompress; cannot package tar.zst archives.");
  }
  const vendorFilter = createVendorFilter(vendorInfo, platformKey);
  await pipeline(
    tar.c({ cwd: sourceDir, filter: vendorFilter.filter, noMtime: true, portable: true }, ["."]),
    zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: ZSTD_COMPRESSION_LEVEL } }),
    createWriteStream(archivePath),
  );
  vendorFilter.assert();
}

// 1. Stage the standalone dashboard runtime into dist/dashboard.
execFileSync(process.execPath, [join(__dirname, "copy-runtime-assets.mjs")], { stdio: "inherit" });
if (!existsSync(serverEntry)) {
  throw new Error(`Expected a staged dashboard server at ${serverEntry}. Did build:rde-standalone run?`);
}

// 2. Zip the staged runtime so the archive root holds apps/ and node_modules/.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync("zip", ["-q", "-r", "-X", zipPath, "."], { cwd: dashboardDist, stdio: "inherit" });

// 3. Stream one archive per supported SDK vendor platform from the single
// staged runtime. The dashboard itself is built only once.
mkdirSync(platformArchivesDir, { recursive: true });
const platformArchives = {};
const vendorInfo = getVendorInfo(dashboardDist);
for (const platformKey of supportedPlatformKeys(vendorInfo)) {
  const archiveName = `dashboard-${version}-${platformKey}.tar.zst`;
  const archivePath = join(platformArchivesDir, archiveName);
  await createTarZstd(dashboardDist, archivePath, vendorInfo, platformKey);
  platformArchives[platformKey] = {
    sha256: createHash("sha256").update(readFileSync(archivePath)).digest("hex"),
    url: getAssetUrl(archiveName, "platform"),
  };
}

// 4. Hash the archive and write the manifest the CLI fetches at runtime.
const sha256 = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
writeFileSync(manifestPath, `${JSON.stringify({ version, sha256, url: assetUrl, platformArchives }, null, 2)}\n`);

console.log(`Packaged dashboard ${version}`);
console.log(`  zip:      ${zipPath}`);
console.log(`  sha256:   ${sha256}`);
console.log(`  url:      ${assetUrl}`);
console.log(`  manifest: ${manifestPath}`);
for (const [platformKey, archive] of Object.entries(platformArchives)) {
  console.log(`  ${platformKey}: ${archive.url}`);
  console.log(`    sha256: ${archive.sha256}`);
}

// Expose values to the release workflow.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `version=${version}`,
      `tag=${tag}`,
      `zip=${zipPath}`,
      `zip_name=${zipName}`,
      `sha256=${sha256}`,
      `manifest=${manifestPath}`,
      `platform_archives_dir=${platformArchivesDir}`,
      "",
    ].join("\n"),
  );
}
