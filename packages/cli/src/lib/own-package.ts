import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export type OwnPackage = {
  name: string,
  version: string,
  binName: string,
};

function unscopedName(packageName: string): string {
  return packageName.includes("/") ? packageName.split("/")[1] : packageName;
}

// The bin name used to re-invoke this CLI via npx. Prefer the `hexclave` bin:
// it is the canonical bin and is guaranteed to exist across published versions,
// so it's safe to invoke against `@latest`. A string `bin` (or none) maps to the
// unscoped package name, per npm convention.
export function resolveBinName(bin: unknown, packageName: string): string {
  if (bin != null && typeof bin === "object") {
    const keys = Object.keys(bin as Record<string, unknown>);
    if (keys.includes("hexclave")) return "hexclave";
    if (keys.length > 0) return keys[0];
  }
  return unscopedName(packageName);
}

// Pure parser, separated from disk I/O so it can be unit-tested directly.
export function parseOwnPackage(raw: unknown): OwnPackage | null {
  if (raw == null || typeof raw !== "object") return null;
  const pkg = raw as { name?: unknown, version?: unknown, bin?: unknown };
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;
  return {
    name: pkg.name,
    version: pkg.version,
    binName: resolveBinName(pkg.bin, pkg.name),
  };
}

// Reads this CLI's own package.json. After bundling, every module collapses
// into dist/index.js, so package.json is one directory up from the module dir
// in both the bundled and source layouts. Returns null on any failure so
// callers degrade gracefully.
export function getOwnPackage(): OwnPackage | null {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return parseOwnPackage(JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8")));
  } catch {
    return null;
  }
}

export function cliVersion(): string | undefined {
  return getOwnPackage()?.version;
}
