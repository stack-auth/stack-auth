#!/usr/bin/env node
import { execFileSync } from "child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readlinkSync, readdirSync, rmSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const qemuSrc = resolve(repoRoot, "docker/local-emulator/qemu");
const envGenScript = resolve(repoRoot, "docker/local-emulator/generate-env-development.mjs");
const envSrc = resolve(repoRoot, "docker/local-emulator/.env.development");
const dashboardRoot = resolve(repoRoot, "apps/dashboard");
const dashboardStandaloneSrc = join(dashboardRoot, ".next/standalone");
const dashboardStaticSrc = join(dashboardRoot, ".next/static");
const dashboardPublicSrc = join(dashboardRoot, "public");
const distDir = join(packageRoot, "dist");
const emulatorDist = join(distDir, "emulator");
const dashboardDist = join(distDir, "dashboard");
const dashboardSymlinksManifestPath = join(dashboardDist, "symlinks.json");

function assertExists(path, message) {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}

function copyEmulatorAssets() {
  execFileSync(process.execPath, [envGenScript], { stdio: "inherit" });

  mkdirSync(emulatorDist, { recursive: true });

  for (const name of ["run-emulator.sh", "common.sh", "cloud-init"]) {
    cpSync(join(qemuSrc, name), join(emulatorDist, name), { recursive: true });
  }

  chmodSync(join(emulatorDist, "run-emulator.sh"), 0o755);
  cpSync(envSrc, join(distDir, ".env.development"));

  console.log(`Copied emulator assets into ${emulatorDist} (+ .env.development into ${distDir}).`);
}

function collectSymlinks(root, current = root) {
  const symlinks = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(path)) {
        continue;
      }
      const target = readlinkSync(path);
      if (isAbsolute(target)) {
        throw new Error(`Dashboard standalone build contains a non-portable absolute symlink: ${path} -> ${target}`);
      }
      symlinks.push({
        path: path.slice(root.length + 1),
        target,
      });
      continue;
    }
    if (entry.isDirectory()) {
      symlinks.push(...collectSymlinks(root, path));
    }
  }
  return symlinks;
}

function copyDashboardAssets() {
  assertExists(
    join(dashboardStandaloneSrc, "apps/dashboard/server.js"),
    "Dashboard standalone build is missing. Run `pnpm exec turbo run build:rde-standalone --filter=@stackframe/dashboard` before building @stackframe/stack-cli.",
  );
  assertExists(
    dashboardStaticSrc,
    "Dashboard static assets are missing. Run `pnpm exec turbo run build:rde-standalone --filter=@stackframe/dashboard` before building @stackframe/stack-cli.",
  );

  rmSync(dashboardDist, { recursive: true, force: true });
  cpSync(dashboardStandaloneSrc, dashboardDist, { recursive: true, verbatimSymlinks: true });
  cpSync(dashboardStaticSrc, join(dashboardDist, "apps/dashboard/.next/static"), { recursive: true });
  if (existsSync(dashboardPublicSrc)) {
    cpSync(dashboardPublicSrc, join(dashboardDist, "apps/dashboard/public"), { recursive: true });
  }
  writeFileSync(dashboardSymlinksManifestPath, `${JSON.stringify(collectSymlinks(dashboardDist), undefined, 2)}\n`);

  console.log(`Copied dashboard standalone runtime into ${dashboardDist}.`);
}

copyEmulatorAssets();
copyDashboardAssets();
