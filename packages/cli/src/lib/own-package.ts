import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export type OwnPackage = {
  name: string,
  version: string,
};

// Pure parser, separated from disk I/O so it can be unit-tested directly.
export function parseOwnPackage(raw: unknown): OwnPackage | null {
  if (raw == null || typeof raw !== "object") return null;
  const pkg = raw as { name?: unknown, version?: unknown };
  if (typeof pkg.name !== "string" || typeof pkg.version !== "string") return null;
  return {
    name: pkg.name,
    version: pkg.version,
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
