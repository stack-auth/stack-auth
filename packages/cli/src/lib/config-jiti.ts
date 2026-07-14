import { createRequire } from "node:module";
import { createJiti, type Jiti } from "jiti";

const CONFIG_IMPORT_SPECIFIERS = [
  "@hexclave/js/config",
  "@hexclave/next/config",
  "@hexclave/react/config",
  "@hexclave/tanstack-start/config",
  "@hexclave/template/config",
  "@stackframe/js",
  "@stackframe/next",
  "@stackframe/react",
  "@stackframe/stack",
  "@stackframe/template",
] as const;

/**
 * Loads config authoring imports from the project's SDK when available, while
 * allowing bare CI checkouts to use the CLI's bundled SDK copy. Jiti resolves
 * imports relative to the config file, so those projects may otherwise fail.
 */
export function createConfigFileJiti(configFilePath: string): Jiti {
  const configRequire = createRequire(configFilePath);
  const unresolvedSpecifiers: string[] = [];

  for (const specifier of CONFIG_IMPORT_SPECIFIERS) {
    try {
      configRequire.resolve(specifier);
    } catch {
      unresolvedSpecifiers.push(specifier);
    }
  }

  const configAliases: Record<string, string> = {};
  if (unresolvedSpecifiers.length > 0) {
    const cliConfigEntrypoint = createRequire(import.meta.url).resolve("@hexclave/js/config");
    for (const specifier of unresolvedSpecifiers) {
      configAliases[specifier] = cliConfigEntrypoint;
    }
  }

  return createJiti(import.meta.url, { alias: configAliases });
}
