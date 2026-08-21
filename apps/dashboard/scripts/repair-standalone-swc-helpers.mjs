#!/usr/bin/env node
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(scriptDir, "..");
const REQUIRED_ESM_HELPERS = [
  {
    exportPath: "_/_interop_require_default",
    filePath: "esm/_interop_require_default.js",
  },
  {
    exportPath: "_/_interop_require_wildcard",
    filePath: "esm/_interop_require_wildcard.js",
  },
];

function readPackageJson(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
}

function isMissingModuleError(error) {
  return error instanceof Error && error.code === "MODULE_NOT_FOUND";
}

function packageRootFromPath(path) {
  let current = resolve(path);
  if (!existsSync(join(current, "package.json"))) {
    current = dirname(current);
  }

  while (current !== dirname(current)) {
    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = readPackageJson(current);
      if (packageJson.name === "@swc/helpers") {
        return current;
      }
    }
    current = dirname(current);
  }

  return undefined;
}

function addSourcePackageRoot(sourcePackageRoots, candidate) {
  if (!existsSync(join(candidate, "package.json"))) {
    return;
  }
  const packageJson = readPackageJson(candidate);
  if (packageJson.name === "@swc/helpers") {
    sourcePackageRoots.add(realpathSync(candidate));
  }
}

function findSourcePackageRoots() {
  const sourcePackageRoots = new Set();
  const resolver = createRequire(join(dashboardRoot, "package.json"));

  for (const request of ["@swc/helpers/package.json", "@swc/helpers"]) {
    try {
      addSourcePackageRoot(
        sourcePackageRoots,
        packageRootFromPath(resolver.resolve(request, { paths: [dashboardRoot] })) ?? dashboardRoot,
      );
    } catch (error) {
      if (!isMissingModuleError(error)) {
        throw error;
      }
    }
  }

  const pnpmRoot = resolve(dashboardRoot, "../../node_modules/.pnpm");
  if (existsSync(pnpmRoot)) {
    for (const entry of readdirSync(pnpmRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("@swc+helpers@")) {
        continue;
      }
      addSourcePackageRoot(
        sourcePackageRoots,
        join(pnpmRoot, entry.name, "node_modules/@swc/helpers"),
      );
    }
  }

  return sourcePackageRoots;
}

function findStandaloneHelperPackages(standaloneRoot) {
  const packagePaths = [];

  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      const isHelperPackage =
        entry.name === "helpers" &&
        (entry.isDirectory() || entry.isSymbolicLink()) &&
        existsSync(join(path, "package.json"));

      if (isHelperPackage) {
        const packageJson = readPackageJson(path);
        if (packageJson.name === "@swc/helpers") {
          packagePaths.push(path);
          continue;
        }
      }

      if (entry.isDirectory()) {
        visit(path);
      }
    }
  }

  visit(standaloneRoot);
  return packagePaths;
}

function findMatchingSourcePackage(sourcePackageRoots, version) {
  return [...sourcePackageRoots].find((sourcePackageRoot) => {
    const packageJson = readPackageJson(sourcePackageRoot);
    return packageJson.version === version;
  });
}

function copyMissingFiles(sourceRoot, destinationRoot) {
  if (!existsSync(sourceRoot)) {
    throw new Error(`Source @swc/helpers runtime directory is missing: ${sourceRoot}`);
  }

  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourcePath = join(sourceRoot, entry.name);
    const destinationPath = join(destinationRoot, entry.name);
    if (entry.isDirectory()) {
      copyMissingFiles(sourcePath, destinationPath);
      continue;
    }
    if (!existsSync(destinationPath)) {
      mkdirSync(dirname(destinationPath), { recursive: true });
      cpSync(sourcePath, destinationPath, { dereference: true });
    }
  }
}

function resolveExportTarget(helperPackageRoot, target) {
  // Resolve through Node's own CJS resolver from inside the standalone tree, so
  // this check picks whichever export condition the standalone server will pick
  // at runtime (esm/*.js via `module-sync` on Node >= 22.10, cjs/*.cjs before).
  const packageNodeModulesRoot = dirname(dirname(helperPackageRoot));
  const resolver = createRequire(join(packageNodeModulesRoot, "package.json"));
  return resolver.resolve(`@swc/helpers/${target}`, { paths: [packageNodeModulesRoot] });
}

export function repairStandaloneSwcHelpers(
  standaloneRoot,
  options = {},
) {
  if (!existsSync(standaloneRoot)) {
    return [];
  }

  const sourcePackageRoots = options.sourcePackageRoots ?? findSourcePackageRoots();
  const repairedPackages = [];
  const repairedRealPaths = new Set();
  for (const helperPackagePath of findStandaloneHelperPackages(standaloneRoot)) {
    const realHelperPackagePath = realpathSync(helperPackagePath);
    if (repairedRealPaths.has(realHelperPackagePath)) {
      continue;
    }
    repairedRealPaths.add(realHelperPackagePath);

    const packageJson = readPackageJson(realHelperPackagePath);
    const sourcePackageRoot = findMatchingSourcePackage(sourcePackageRoots, packageJson.version);
    if (sourcePackageRoot == null) {
      throw new Error(
        `Could not find a complete @swc/helpers source package for version ${packageJson.version} needed by ${helperPackagePath}.`,
      );
    }

    // NFT traces this package under the `require` condition and therefore copy
    // only the cjs/*.cjs targets. Node >= 22.10 also considers the
    // `module-sync` export condition for these same bare @swc/helpers/_/*
    // requests and selects esm/*.js instead. This is an upstream tracing gap:
    // the standalone package keeps the export map but omits the files that
    // modern Node resolves. Repair only the runtime esm/ and cjs/ trees here;
    // src/ and scripts/ are intentionally not copied into this size-sensitive
    // artifact.
    copyMissingFiles(join(sourcePackageRoot, "esm"), join(realHelperPackagePath, "esm"));
    copyMissingFiles(join(sourcePackageRoot, "cjs"), join(realHelperPackagePath, "cjs"));

    for (const requiredHelper of REQUIRED_ESM_HELPERS) {
      const requiredPath = join(realHelperPackagePath, requiredHelper.filePath);
      if (!existsSync(requiredPath)) {
        throw new Error(
          `Repaired @swc/helpers@${packageJson.version} is missing required export target ${requiredPath}.`,
        );
      }
      if (!existsSync(resolveExportTarget(realHelperPackagePath, requiredHelper.exportPath))) {
        throw new Error(
          `Repaired @swc/helpers@${packageJson.version} cannot resolve export target ${requiredHelper.exportPath}.`,
        );
      }
    }

    repairedPackages.push(realHelperPackagePath);
  }

  return repairedPackages;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const standaloneRoot = process.argv[2] != null
    ? resolve(process.cwd(), process.argv[2])
    : join(
        resolve(
          dashboardRoot,
          process.env.HEXCLAVE_DASHBOARD_NEXT_DIST_DIR ?? ".next",
        ),
        "standalone",
      );
  const repairedPackages = repairStandaloneSwcHelpers(standaloneRoot);
  if (repairedPackages.length > 0) {
    console.log(`Repaired @swc/helpers in ${repairedPackages.length} standalone package(s).`);
  }
}
