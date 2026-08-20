import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const HELPERS_SPEC_PREFIX = "@swc+helpers@";
const ESM_HELPER = join("esm", "_interop_require_default.js");

/**
 * next@16.3.1's standalone tracer copies only CJS `@swc/helpers`. Node 24
 * then resolves `module-sync` to `esm/_interop_require_default.js` and the
 * dashboard process exits before `hexclave dev` can spawn the app server.
 */
export function copySwcHelpersIntoStandalone(standaloneRoot, repoPnpmRoot) {
  const standalonePnpm = join(standaloneRoot, "node_modules", ".pnpm");
  if (!existsSync(standalonePnpm)) {
    return;
  }

  for (const specifier of readdirSync(standalonePnpm)) {
    if (!specifier.startsWith(HELPERS_SPEC_PREFIX)) {
      continue;
    }
    const dest = join(standalonePnpm, specifier, "node_modules", "@swc", "helpers");
    const src = join(repoPnpmRoot, specifier, "node_modules", "@swc", "helpers");
    if (!existsSync(join(dest, "package.json"))) {
      continue;
    }
    if (existsSync(join(dest, ESM_HELPER))) {
      continue;
    }
    if (!existsSync(join(src, ESM_HELPER))) {
      throw new Error(`Standalone @swc/helpers (${specifier}) is missing ${ESM_HELPER}, and ${src} does not have it either.`);
    }
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
  }
}
