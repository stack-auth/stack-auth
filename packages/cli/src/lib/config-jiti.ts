import { createRequire } from "node:module";
import { CONFIG_IMPORT_PACKAGES } from "@hexclave/shared/dist/config-rendering";
import { createJiti, type Jiti } from "jiti";

// Config files import `defineHexclaveConfig` and the config types from the SDK.
// New files import from the package root (e.g. `@hexclave/js`); older ones
// import from the deprecated `<pkg>/config` subpath. Both re-export the same
// side-effect-free helpers, so either can be aliased to the CLI's bundled copy.
const CONFIG_IMPORT_SPECIFIERS: readonly string[] = [
  ...CONFIG_IMPORT_PACKAGES,
  ...CONFIG_IMPORT_PACKAGES
    .filter((pkg) => pkg.startsWith("@hexclave/"))
    .map((pkg) => `${pkg}/config`),
];

/**
 * Loads config authoring imports from the project's SDK when available, while
 * allowing bare checkouts to use the CLI's bundled SDK copy. Jiti resolves
 * imports relative to the config file, so a project without the SDK installed
 * (e.g. `config push` in a fresh CI checkout) would otherwise fail to load its
 * config. We only alias specifiers that can't be resolved from the config
 * file's directory, so a project-installed SDK always takes precedence.
 */
export function createConfigFileJiti(configFilePath: string): Jiti {
  const configRequire = createRequire(configFilePath);
  const cliRequire = createRequire(import.meta.url);

  const configAliases: Record<string, string> = {};
  for (const specifier of CONFIG_IMPORT_SPECIFIERS) {
    try {
      configRequire.resolve(specifier);
    } catch {
      // Unresolvable from the project: fall back to the CLI's own bundled copy.
      // `/config` subpaths map to the bundled `@hexclave/js/config` entrypoint;
      // everything else maps to the bundled `@hexclave/js` root.
      const fallback = specifier.endsWith("/config") ? "@hexclave/js/config" : "@hexclave/js";
      configAliases[specifier] = cliRequire.resolve(fallback);
    }
  }

  return createJiti(import.meta.url, { alias: configAliases });
}
