#!/usr/bin/env node
// Packages the standalone RDE dashboard into a GitHub Release artifact: a
// dashboard-<version>.zip plus a manifest.json ({ version, sha256, url }) that
// dashboard-release.ts fetches at runtime. Run by dashboard-release.yaml;
// requires the `zip` CLI (present on ubuntu runners).
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

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
const tag = `dashboard-v${version}`;
const assetUrl = baseUrlOverride != null && baseUrlOverride.length > 0
  ? `${baseUrlOverride}/${zipName}`
  : `https://github.com/${repository}/releases/download/${tag}/${zipName}`;

// 1. Stage the standalone dashboard runtime into dist/dashboard.
execFileSync(process.execPath, [join(__dirname, "copy-runtime-assets.mjs")], { stdio: "inherit" });
if (!existsSync(serverEntry)) {
  throw new Error(`Expected a staged dashboard server at ${serverEntry}. Did build:rde-standalone run?`);
}

// 2. Zip the staged runtime so the archive root holds apps/ and node_modules/.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
execFileSync("zip", ["-q", "-r", "-X", zipPath, "."], { cwd: dashboardDist, stdio: "inherit" });

// 3. Hash the archive and write the manifest the CLI fetches at runtime.
const sha256 = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
writeFileSync(manifestPath, `${JSON.stringify({ version, sha256, url: assetUrl }, null, 2)}\n`);

console.log(`Packaged dashboard ${version}`);
console.log(`  zip:      ${zipPath}`);
console.log(`  sha256:   ${sha256}`);
console.log(`  url:      ${assetUrl}`);
console.log(`  manifest: ${manifestPath}`);

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
      "",
    ].join("\n"),
  );
}
