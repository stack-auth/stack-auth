import { existsSync, readFileSync } from "fs";
import path from "path";
import { detectConfigImportPackage } from "./config-rendering";

/**
 * Walks up from `dir` to find the nearest `package.json` and returns the
 * best SDK package to use for the `HexclaveConfig` type import.
 *
 * Separated from `config-rendering.ts` because it requires Node.js APIs (`fs`,
 * `path`) that cannot be bundled for the browser.
 */
export function detectImportPackageFromDir(dir: string): string | undefined {
  let current = dir;
  while (true) {
    const pkgPath = path.join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        const deps = [
          ...Object.keys(pkg.dependencies ?? {}),
          ...Object.keys(pkg.devDependencies ?? {}),
        ];
        return detectConfigImportPackage(deps);
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}
