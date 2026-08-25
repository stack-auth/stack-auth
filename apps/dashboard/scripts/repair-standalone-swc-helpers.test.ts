import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { repairStandaloneSwcHelpers } from "./repair-standalone-swc-helpers.mjs";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "hexclave-repair-swc-helpers.untracked-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writePackageJson(packageRoot: string, version: string) {
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: "@swc/helpers",
      version,
      exports: {
        "./_/_interop_require_default": {
          "module-sync": "./esm/_interop_require_default.js",
          default: "./cjs/_interop_require_default.cjs",
        },
        "./_/_interop_require_wildcard": {
          "module-sync": "./esm/_interop_require_wildcard.js",
          default: "./cjs/_interop_require_wildcard.cjs",
        },
      },
    }),
  );
}

function makeSourcePackage(root: string, version = "0.5.23") {
  const sourcePackageRoot = join(root, "source", "@swc", "helpers");
  writePackageJson(sourcePackageRoot, version);
  mkdirSync(join(sourcePackageRoot, "esm"), { recursive: true });
  mkdirSync(join(sourcePackageRoot, "cjs"), { recursive: true });
  writeFileSync(join(sourcePackageRoot, "esm/_interop_require_default.js"), "export default {};\n");
  writeFileSync(join(sourcePackageRoot, "esm/_interop_require_wildcard.js"), "export default {};\n");
  writeFileSync(join(sourcePackageRoot, "cjs/_interop_require_default.cjs"), "module.exports = {};\n");
  writeFileSync(join(sourcePackageRoot, "cjs/_interop_require_wildcard.cjs"), "module.exports = {};\n");
  return sourcePackageRoot;
}

function makeStandalonePackage(root: string, version = "0.5.23") {
  const standaloneRoot = join(root, "standalone");
  const helperPackageRoot = join(
    standaloneRoot,
    "node_modules/.pnpm/@swc+helpers@" + version + "/node_modules/@swc/helpers",
  );
  writePackageJson(helperPackageRoot, version);
  mkdirSync(join(helperPackageRoot, "cjs"), { recursive: true });
  writeFileSync(join(helperPackageRoot, "cjs/_interop_require_default.cjs"), "module.exports = {};\n");
  writeFileSync(join(helperPackageRoot, "cjs/_interop_require_wildcard.cjs"), "module.exports = {};\n");
  const symlinkRoot = join(
    standaloneRoot,
    "node_modules/.pnpm/next@16.3.1/node_modules/@swc",
  );
  mkdirSync(symlinkRoot, { recursive: true });
  symlinkSync(relative(symlinkRoot, helperPackageRoot), join(symlinkRoot, "helpers"), "dir");
  return { standaloneRoot, helperPackageRoot };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("repairStandaloneSwcHelpers", () => {
  it("copies missing runtime export targets and is idempotent", () => {
    const root = makeTemporaryDirectory();
    const sourcePackageRoot = makeSourcePackage(root);
    const { standaloneRoot, helperPackageRoot } = makeStandalonePackage(root);

    expect(repairStandaloneSwcHelpers(standaloneRoot, { sourcePackageRoots: [sourcePackageRoot] })).toHaveLength(1);
    expect(readFileSync(join(helperPackageRoot, "esm/_interop_require_default.js"), "utf8")).toContain("export default");
    expect(readFileSync(join(helperPackageRoot, "esm/_interop_require_wildcard.js"), "utf8")).toContain("export default");

    const firstRepair = readFileSync(join(helperPackageRoot, "esm/_interop_require_default.js"), "utf8");
    expect(repairStandaloneSwcHelpers(standaloneRoot, { sourcePackageRoots: [sourcePackageRoot] })).toHaveLength(1);
    expect(readFileSync(join(helperPackageRoot, "esm/_interop_require_default.js"), "utf8")).toBe(firstRepair);
  });

  it("does nothing when standalone output does not exist", () => {
    const root = makeTemporaryDirectory();

    expect(repairStandaloneSwcHelpers(join(root, "missing-standalone"))).toEqual([]);
  });

  it("fails loudly when no matching source package exists", () => {
    const root = makeTemporaryDirectory();
    const sourcePackageRoot = makeSourcePackage(root, "0.5.22");
    const { standaloneRoot } = makeStandalonePackage(root, "0.5.23");

    expect(() =>
      repairStandaloneSwcHelpers(standaloneRoot, { sourcePackageRoots: [sourcePackageRoot] }),
    ).toThrow("Could not find a complete @swc/helpers source package for version 0.5.23");
  });
});
