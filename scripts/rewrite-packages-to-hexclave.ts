/**
 * Rewrite-then-republish: in-place mutate each publishable `@stackframe/*`
 * package.json into the `@hexclave/*` mirror name, AND rewrite every
 * `@stackframe/*` reference inside `dist/` (bundled `require()` / `import`
 * specifiers + the build-time package-version sentinel) so the published
 * `@hexclave/*` artifacts resolve their cross-package deps against the
 * `@hexclave/*` mirror packages we just renamed. `pnpm publish -r` picks
 * them up again on the next workflow step. The workflow runs on a clean
 * checkout each time, so no revert is needed.
 *
 * Mapping per RENAME-TO-HEXCLAVE.md (Tier 2). All mirror packages share
 * one version (read from HEXCLAVE_VERSION env or `--version <x>`); cross-
 * package deps are pinned to that exact version since they're a single
 * substitution.
 *
 * The `@hexclave/cli` mirror additionally registers a `hexclave` bin
 * alongside `stack` so `npx @hexclave/cli@latest init` works.
 *
 * Not mirrored (per the plan): `@stackframe/template` (codegen source),
 * `@stackframe/init-stack` (kept under existing name; new-user onboarding
 * moves to the CLI's `init` subcommand).
 */
import fs from "node:fs";
import path from "node:path";

// Source @stackframe/* name → target @hexclave/* name.
// Special-cased: @stackframe/stack (the Next.js-specific SDK) publishes as
// @hexclave/next under the new brand, mirroring how @hexclave/react and
// @hexclave/js identify the framework they target. The dist-content rewriter
// below propagates this through every cross-package require/import specifier
// and the build-time package-version sentinel.
const PACKAGE_NAME_MAP: Record<string, string> = {
  "@stackframe/react": "@hexclave/react",
  "@stackframe/stack": "@hexclave/next",
  "@stackframe/js": "@hexclave/js",
  "@stackframe/stack-shared": "@hexclave/shared",
  "@stackframe/stack-ui": "@hexclave/ui",
  "@stackframe/stack-sc": "@hexclave/sc",
  "@stackframe/stack-cli": "@hexclave/cli",
  "@stackframe/tanstack-start": "@hexclave/tanstack-start",
  "@stackframe/dashboard-ui-components": "@hexclave/dashboard-ui-components",
};

// Directories under packages/ that hold the publishable @stackframe/* packages.
const PACKAGE_DIRS = [
  "packages/react",
  "packages/stack",
  "packages/js",
  "packages/stack-shared",
  "packages/stack-ui",
  "packages/stack-sc",
  "packages/stack-cli",
  "packages/tanstack-start",
  "packages/dashboard-ui-components",
];

function getHexclaveVersion(): string {
  const arg = process.argv.find((a) => a.startsWith("--version="));
  const version = arg ? arg.split("=")[1] : process.env.HEXCLAVE_VERSION;
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error(
      "rewrite-packages-to-hexclave: pass --version=X.Y.Z or set HEXCLAVE_VERSION.",
    );
  }
  return version;
}

function rewriteDepsObject(
  deps: Record<string, string> | undefined,
  hexclaveVersion: string,
): Record<string, string> | undefined {
  if (!deps) return deps;
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(deps)) {
    if (PACKAGE_NAME_MAP[name]) {
      out[PACKAGE_NAME_MAP[name]] = hexclaveVersion;
    } else {
      out[name] = spec;
    }
  }
  return out;
}

function rewritePackage(dir: string, hexclaveVersion: string): void {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.log(`skip: ${pkgPath} does not exist`);
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const oldName: string = pkg.name;
  const oldVersion: string = pkg.version;
  const newName = PACKAGE_NAME_MAP[oldName];
  if (!newName) {
    console.log(`skip: ${oldName} not in mirror map`);
    return;
  }

  pkg.name = newName;
  pkg.version = hexclaveVersion;
  pkg.dependencies = rewriteDepsObject(pkg.dependencies, hexclaveVersion);
  pkg.peerDependencies = rewriteDepsObject(pkg.peerDependencies, hexclaveVersion);
  pkg.devDependencies = rewriteDepsObject(pkg.devDependencies, hexclaveVersion);
  pkg.optionalDependencies = rewriteDepsObject(pkg.optionalDependencies, hexclaveVersion);

  // The CLI gets a hexclave bin alias alongside the existing stack one, so
  // `npx @hexclave/cli@latest init` is the new taught entrypoint.
  if (newName === "@hexclave/cli" && pkg.bin && typeof pkg.bin === "object") {
    if (pkg.bin.stack && !pkg.bin.hexclave) {
      pkg.bin = { hexclave: pkg.bin.stack, ...pkg.bin };
    }
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`rewrote: ${oldName} → ${newName}@${hexclaveVersion}`);

  // Rewrite cross-package require()/import specifiers and the build-time
  // package-version sentinel inside dist/. tsdown bundles peer/shared deps
  // as external `require("@stackframe/...")` calls — without this rewrite,
  // installing only @hexclave/* leaves those requires unresolvable at runtime.
  rewriteDistFiles(dir, oldName, oldVersion, hexclaveVersion);
}

// Bundled artifacts contain literal package-name strings (require/import
// specifiers, the build-time `js <pkg>@<ver>` sentinel, occasional source-hint
// strings). Rewriting them in lockstep with the package.json rename keeps the
// published @hexclave/* artifacts self-consistent.
function rewriteDistFiles(
  dir: string,
  oldName: string,
  oldVersion: string,
  hexclaveVersion: string,
): void {
  const distDir = path.join(dir, "dist");
  if (!fs.existsSync(distDir)) {
    console.log(`  no dist/ to rewrite under ${dir}`);
    return;
  }

  // Longest names first so e.g. `@stackframe/stack-shared` doesn't get
  // half-replaced by the shorter `@stackframe/stack` prefix.
  const sortedMappings = Object.entries(PACKAGE_NAME_MAP).sort(
    (a, b) => b[0].length - a[0].length,
  );

  let totalFiles = 0;
  let touchedFiles = 0;

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match the build-time `js <oldName>@<oldVersion>` sentinel exactly.
  const sentinelPattern = new RegExp(
    `js ${escapeRegex(oldName)}@${escapeRegex(oldVersion)}`,
    "g",
  );
  const newSentinel = `js ${PACKAGE_NAME_MAP[oldName]}@${hexclaveVersion}`;

  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!entry.isFile()) continue;
      // Skip binary artifacts; only rewrite text files the bundler produced.
      // Sourcemaps (.map) are intentionally excluded: they embed original file
      // paths and (when sourcesContent is set) the source text — a blanket
      // string replace inside them would corrupt the mappings and break
      // production-error debugging. The code references that actually need
      // rewriting all live in the .js/.cjs/.d.ts compiled output.
      if (!/\.(?:m?js|cjs|d\.m?ts|d\.cts|json|html|txt|md)$/.test(entry.name)) continue;
      totalFiles += 1;

      const original = fs.readFileSync(p, "utf-8");
      let updated = original;

      // Rewrite the build-time package-version sentinel FIRST, before the
      // bare-name sweep below. The sentinel encodes both the package name
      // AND the package version (`js @stackframe/js@2.8.105`) and we need
      // to bump both halves in lockstep. If the name sweep ran first it
      // would rewrite just the name half (→ `js @hexclave/js@2.8.105`),
      // and then this sentinel-specific regex — built from `oldName` —
      // would no longer match anything in `updated`, silently leaving
      // the version stuck at the old @stackframe version. Doing the
      // sentinel rewrite first produces the final string in one shot;
      // the name sweep that follows won't touch it because the rewritten
      // sentinel contains no `@stackframe/*` substrings to match.
      updated = updated.replace(sentinelPattern, newSentinel);

      for (const [oldPkg, newPkg] of sortedMappings) {
        if (!updated.includes(oldPkg)) continue;
        // Replace the bare package name as a whole token. Subpaths
        // (`@stackframe/stack-shared/dist/utils/errors`) trail naturally.
        const pattern = new RegExp(escapeRegex(oldPkg), "g");
        updated = updated.replace(pattern, newPkg);
      }

      if (updated !== original) {
        fs.writeFileSync(p, updated);
        touchedFiles += 1;
      }
    }
  };

  walk(distDir);
  console.log(`  rewrote dist/: ${touchedFiles}/${totalFiles} files in ${dir}`);
}

function main(): void {
  const hexclaveVersion = getHexclaveVersion();
  const repoRoot = path.resolve(__dirname, "..");
  for (const rel of PACKAGE_DIRS) {
    rewritePackage(path.join(repoRoot, rel), hexclaveVersion);
  }
}

main();
