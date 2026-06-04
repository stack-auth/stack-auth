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

// Packages that are only needed at build time or are unnecessary in the
// standalone runtime. These are pulled in by file tracing (e.g. via jiti/next)
// but are never loaded during production server execution.
// sharp and its native bindings (@img/*) are excluded because the RDE
// standalone build sets images.unoptimized=true.
const EXCLUDED_RUNTIME_PACKAGES = new Set([
  "typescript",
  "sharp",
  "@img/sharp-libvips-linux-x64",
  "@img/sharp-linux-x64",
  "@img/colour",
]);

function hoistPnpmNodeModules(pnpmDir) {
  // The pnpm store keeps a shared `node_modules/` directory for hoisted
  // packages that peer-dep symlinks resolve through. After we dereference all
  // symlinks, these packages must also be available at the top-level
  // `node_modules/` so that Node.js module resolution finds them.
  const sharedNodeModules = join(pnpmDir, "node_modules");
  if (!existsSync(sharedNodeModules)) {
    return;
  }
  const destNodeModules = dirname(pnpmDir);
  for (const entry of readdirSync(sharedNodeModules, { withFileTypes: true })) {
    const name = entry.name;
    if (name.startsWith(".")) {
      continue;
    }
    if (name.startsWith("@")) {
      // Scoped package — iterate one level deeper
      const scopeDir = join(sharedNodeModules, name);
      for (const scopedEntry of readdirSync(scopeDir, { withFileTypes: true })) {
        const fullName = join(name, scopedEntry.name);
        if (EXCLUDED_RUNTIME_PACKAGES.has(fullName)) {
          continue;
        }
        const dest = join(destNodeModules, fullName);
        if (!existsSync(dest)) {
          cpSync(join(scopeDir, scopedEntry.name), dest, { recursive: true, dereference: true });
        }
      }
    } else {
      if (EXCLUDED_RUNTIME_PACKAGES.has(name)) {
        continue;
      }
      const dest = join(destNodeModules, name);
      if (!existsSync(dest)) {
        cpSync(join(sharedNodeModules, name), dest, { recursive: true, dereference: true });
      }
    }
  }
}

function removePnpmStore(nodeModulesDir) {
  const pnpmDir = join(nodeModulesDir, ".pnpm");
  if (!existsSync(pnpmDir)) {
    return;
  }
  hoistPnpmNodeModules(pnpmDir);
  rmSync(pnpmDir, { recursive: true, force: true });
}

function removeExcludedPackages(nodeModulesDir) {
  for (const pkg of EXCLUDED_RUNTIME_PACKAGES) {
    const pkgPath = join(nodeModulesDir, pkg);
    if (existsSync(pkgPath)) {
      rmSync(pkgPath, { recursive: true, force: true });
    }
  }
}

function removeNftJsonFiles(dir) {
  // .nft.json files are Next.js file-trace manifests used only during the build
  // to determine which files to include in standalone output. They are not
  // needed at runtime and add ~4 MB to the package.
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      removeNftJsonFiles(path);
    } else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
      rmSync(path);
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

  // Remove the .pnpm store from the output. After cpSync with dereference:true
  // all symlinks are resolved to real files, so the .pnpm directory is entirely
  // duplicate content (~113 MB). We first hoist any shared packages that only
  // exist inside .pnpm/node_modules/ to the top-level node_modules/.
  const dashboardNodeModules = join(dashboardDist, "node_modules");
  removePnpmStore(dashboardNodeModules);
  removeExcludedPackages(dashboardNodeModules);
  removeNftJsonFiles(join(dashboardDist, "apps/dashboard/.next"));

  console.log(`Copied dashboard standalone runtime into ${dashboardDist}.`);
}

copyDashboardAssets();
