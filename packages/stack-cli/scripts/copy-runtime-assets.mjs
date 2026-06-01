#!/usr/bin/env node
import { cpSync, existsSync, readlinkSync, readdirSync, rmSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const dashboardRoot = resolve(repoRoot, "apps/dashboard");
const dashboardStandaloneSrc = join(dashboardRoot, ".next/standalone");
const dashboardStaticSrc = join(dashboardRoot, ".next/static");
const dashboardPublicSrc = join(dashboardRoot, "public");
const distDir = join(packageRoot, "dist");
const dashboardDist = join(distDir, "dashboard");

function assertExists(path, message) {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}

function shouldCopyDashboardFile(path) {
  return existsSync(path);
}

function copyDashboardSymlinkTarget(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, dereference: true, filter: shouldCopyDashboardFile });
}

function splitDashboardPath(root, path) {
  return relative(root, path).split(/[\\/]+/);
}

function getDashboardDependencyName(pnpmRoot, path) {
  const parts = splitDashboardPath(pnpmRoot, path);
  const nodeModulesIndex = parts.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0) {
    return undefined;
  }
  const dependencyParts = parts.slice(nodeModulesIndex + 1);
  if (dependencyParts.length === 1) {
    return dependencyParts[0];
  }
  if (dependencyParts.length === 2 && dependencyParts[0].startsWith("@")) {
    return join(dependencyParts[0], dependencyParts[1]);
  }
  return undefined;
}

function copyDashboardHoistedDependencies(pnpmRoot, current = pnpmRoot) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) {
      copyDashboardHoistedDependencies(pnpmRoot, path);
      continue;
    }
    if (!entry.isSymbolicLink() || !existsSync(path)) {
      continue;
    }
    const dependencyName = getDashboardDependencyName(pnpmRoot, path);
    if (dependencyName == null) {
      continue;
    }
    const target = resolve(current, readlinkSync(path));
    const parts = splitDashboardPath(pnpmRoot, path);
    if (parts[0] !== "node_modules" && existsSync(join(target, "package.json"))) {
      copyDashboardSymlinkTarget(target, join(dashboardDist, "node_modules", dependencyName));
    }
  }
}

function copyDashboardAssets() {
  assertExists(
    join(dashboardStandaloneSrc, "apps/dashboard/server.js"),
    "Dashboard standalone build is missing. Run `pnpm exec turbo run build:rde-standalone --filter=@hexclave/dashboard` before building @hexclave/cli.",
  );
  assertExists(
    dashboardStaticSrc,
    "Dashboard static assets are missing. Run `pnpm exec turbo run build:rde-standalone --filter=@hexclave/dashboard` before building @hexclave/cli.",
  );

  rmSync(dashboardDist, { recursive: true, force: true });
  cpSync(dashboardStandaloneSrc, dashboardDist, { recursive: true, dereference: true, filter: shouldCopyDashboardFile });
  cpSync(dashboardStaticSrc, join(dashboardDist, "apps/dashboard/.next/static"), { recursive: true });
  if (existsSync(dashboardPublicSrc)) {
    cpSync(dashboardPublicSrc, join(dashboardDist, "apps/dashboard/public"), { recursive: true });
  }
  copyDashboardHoistedDependencies(join(dashboardStandaloneSrc, "node_modules/.pnpm"));

  console.log(`Copied dashboard standalone runtime into ${dashboardDist}.`);
}

copyDashboardAssets();
