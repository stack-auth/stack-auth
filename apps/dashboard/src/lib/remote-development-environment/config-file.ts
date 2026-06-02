import "server-only";

import { showOnboardingStackConfigValue } from "@hexclave/shared/dist/config-authoring";
import { Config, ConfigValue, NormalizedConfig, isValidConfig, normalize, override } from "@hexclave/shared/dist/config/format";
import { detectImportPackageFromDir, renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import { stackConfigFileExportsConfig, tryParseStackConfigFileContent } from "@hexclave/shared/dist/stack-config-file";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createJiti } from "jiti";
import path from "path";
import { runConfigUpdateAgent } from "./config-update-agent";

const jiti = createJiti(import.meta.url, { moduleCache: false });

const LOG_PREFIX = "[Stack RDE]";

type ConfigModule = {
  config?: unknown,
};

function isConfigModule(value: unknown): value is ConfigModule {
  return value !== null && typeof value === "object";
}

export function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveConfigFilePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const looksLikeConfigFile = /\.(ts|js|mjs|cjs)$/i.test(resolved);
  if (looksLikeConfigFile) {
    return resolved;
  }
  // Hexclave rebrand: prefer the new `hexclave.config.ts` filename inside the
  // directory, falling back to the legacy `stack.config.ts` for existing
  // projects. If neither exists, default to the new filename.
  const hexclaveCandidate = path.join(resolved, "hexclave.config.ts");
  const legacyCandidate = path.join(resolved, "stack.config.ts");
  if (existsSync(hexclaveCandidate)) {
    return hexclaveCandidate;
  }
  if (existsSync(legacyCandidate)) {
    return legacyCandidate;
  }
  return hexclaveCandidate;
}

export function ensureConfigFileExists(configFilePath: string): void {
  if (existsSync(configFilePath)) return;
  mkdirSync(path.dirname(configFilePath), { recursive: true });
  renderConfigObjectToFile(configFilePath, {});
}

export async function readConfigObject(configFilePath: string): Promise<Config> {
  return (await readConfigFile(configFilePath)).config;
}

export async function readConfigFile(configFilePath: string): Promise<{ config: Config, showOnboarding: boolean }> {
  ensureConfigFileExists(configFilePath);
  const content = readFileSync(configFilePath, "utf-8");
  if (content.trim() === "") {
    return {
      config: {},
      showOnboarding: false,
    };
  }

  const configModule = await jiti.import<unknown>(configFilePath);
  if (!isConfigModule(configModule)) {
    throw new Error(`Invalid config in ${configFilePath}. The file must export a plain \`config\` object or "show-onboarding".`);
  }

  const config = configModule.config;
  if (config === showOnboardingStackConfigValue) {
    return {
      config: {},
      showOnboarding: true,
    };
  }
  if (!isValidConfig(config)) {
    throw new Error(`Invalid config in ${configFilePath}.`);
  }
  return {
    config,
    showOnboarding: false,
  };
}

/**
 * Deterministically renders a config object into the file, overwriting whatever
 * was there. This is the canonical, lossy representation (a single
 * `export const config = { ...JSON... }`); it does not preserve imports, helper
 * wrappers, comments, or external file references. Only use it when there is no
 * existing structure to preserve (a brand-new/empty file, or a file that is
 * already a plain static literal). Otherwise use {@link updateConfigObject}.
 */
function renderConfigObjectToFile(configFilePath: string, config: Config): void {
  const dir = path.dirname(configFilePath);
  mkdirSync(dir, { recursive: true });
  const importPackage = detectImportPackageFromDir(dir);
  const content = renderConfigFileContent(config, importPackage);
  const tempPath = path.join(dir, `.stack.config.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, configFilePath);
}

/**
 * Applies a config update to the file at `configFilePath`, merging `configUpdate`
 * (a partial config, possibly using dot-notation keys) over the current config.
 *
 * Unlike a plain overwrite, this preserves the way the user authored their
 * config file. If the file is already a plain static literal (no imports,
 * wrappers, or computed values), the update is applied deterministically. If the
 * file has custom structure — most importantly when a config value is sourced
 * from an external file via `import x from "./file.txt" with { type: "text" }` —
 * an AI agent applies the change in place, editing the referenced external files
 * instead of inlining their contents back into the config.
 *
 * The result is validated before returning: when the config is evaluable we
 * assert it deep-equals the intended merge; otherwise we fall back to a
 * structural check. On any failure we throw rather than silently leaving the
 * file in an unexpected state.
 */
export async function updateConfigObject(configFilePath: string, configUpdate: Config): Promise<void> {
  ensureConfigFileExists(configFilePath);
  const content = readFileSync(configFilePath, "utf-8");

  // Fast path: a plain static literal config has no structure to preserve, so we
  // can regenerate it deterministically without spending an AI call.
  const staticConfig = tryParseStackConfigFileContent(content, configFilePath);
  if (staticConfig != null) {
    let current: Config;
    if (staticConfig === showOnboardingStackConfigValue) {
      current = {};
    } else if (isValidConfig(staticConfig)) {
      current = staticConfig;
    } else {
      throw new Error(`Config in ${configFilePath} parsed to a static literal that is not a valid config object.`);
    }
    const target = override(current, configUpdate);
    renderConfigObjectToFile(configFilePath, target);
    const written = tryParseStackConfigFileContent(readFileSync(configFilePath, "utf-8"), configFilePath);
    if (written == null || written === showOnboardingStackConfigValue || !isValidConfig(written) || !configsEqual(canonicalizeConfig(written), canonicalizeConfig(target))) {
      throw new Error(`Config update validation failed for ${configFilePath}: the regenerated file does not match the expected configuration.`);
    }
    return;
  }

  // Custom structure: capture an evaluable baseline if we can (so we can do a
  // full semantic check afterwards), then let the agent apply the change.
  const baselineConfig = await tryReadConfigForValidation(configFilePath);

  await runConfigUpdateAgent({
    prompt: buildConfigUpdatePrompt(path.basename(configFilePath), configUpdate),
    cwd: path.dirname(configFilePath),
  });

  await validateAgentUpdate(configFilePath, baselineConfig, configUpdate);
}

/**
 * Reads and evaluates the config for use as a validation baseline, returning
 * `null` if the file references values our loader can't evaluate (e.g. text
 * imports). A `null` result is expected for the exact files this feature
 * targets, so we degrade to a structural check rather than failing.
 */
async function tryReadConfigForValidation(configFilePath: string): Promise<Config | null> {
  try {
    return (await readConfigFile(configFilePath)).config;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not evaluate config for validation baseline; will fall back to a structural check`, {
      configFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function validateAgentUpdate(configFilePath: string, baselineConfig: Config | null, configUpdate: Config): Promise<void> {
  if (baselineConfig != null) {
    const target = canonicalizeConfig(override(baselineConfig, configUpdate));
    const result = canonicalizeConfig((await readConfigFile(configFilePath)).config);
    if (!configsEqual(result, target)) {
      throw new Error(`Config update validation failed for ${configFilePath}: the updated file does not evaluate to the expected configuration.`);
    }
    return;
  }

  // The config couldn't be evaluated (e.g. it imports external text files), so a
  // full semantic comparison isn't possible. Ensure at least that the agent left
  // a syntactically valid file that still exports `config`.
  const content = readFileSync(configFilePath, "utf-8");
  if (!stackConfigFileExportsConfig(content, configFilePath)) {
    throw new Error(`Config update validation failed for ${configFilePath}: the updated file no longer exports a valid \`config\`.`);
  }
}

type ConfigChange = { path: string, value: ConfigValue | undefined };

/**
 * Flattens a (possibly dot-notation) config update into individual leaf changes,
 * so the agent gets an explicit list of which config paths to change. Arrays and
 * primitives are leaves; nested plain objects are walked. A `value` of
 * `undefined` denotes a field that should be removed.
 */
function flattenConfigUpdate(update: Config): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const walk = (prefix: string, obj: Config): void => {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix === "" ? key : `${prefix}.${key}`;
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        walk(fullPath, value);
      } else {
        changes.push({ path: fullPath, value });
      }
    }
  };
  walk("", update);
  return changes;
}

function buildConfigUpdatePrompt(configFileName: string, configUpdate: Config): string {
  const changes = flattenConfigUpdate(configUpdate);
  const changeLines = changes.map(({ path: configPath, value }) => {
    if (value === undefined) {
      return `- \`${configPath}\`: (remove this field)`;
    }
    return `- \`${configPath}\`: set to ${JSON.stringify(value)}`;
  }).join("\n");

  return `You are editing a Hexclave / Stack Auth configuration file in place. Apply a set of configuration changes WITHOUT changing how the file is written.

Config file: \`${configFileName}\` (in the current working directory).

The file exports a \`config\` object (it may be wrapped in a helper such as \`defineStackConfig(...)\`). Some config values may be sourced from other files via imports, for example:

    import welcomeEmail from "./welcome-email.tsx" with { type: "text" };
    export const config = { emails: { templates: { welcome: welcomeEmail } } };

Apply EXACTLY these changes. Paths use dot notation, so \`a.b.c\` refers to \`config.a.b.c\`:

${changeLines}

Rules:
- Change ONLY the config paths listed above. Leave every other part of the file byte-for-byte unchanged: imports, comments, formatting, helper wrappers, and any config fields not listed.
- If a listed path's value is currently provided by an imported external file (like the \`import ... with { type: "text" }\` example above), DO NOT inline the new value into the config file. Instead, overwrite that external file with the new value and keep the import statement intact.
- If a listed path's value is a plain inline literal, edit it inline.
- For a path marked "(remove this field)", delete that field from the config.
- Keep the file valid: it must still export a \`config\` that, once evaluated, reflects the new values exactly.
- Do not run any shell commands and do not create files other than what is required to apply these changes.`;
}

/**
 * Resolves a config (which may contain dot-notation keys) into its canonical
 * nested form, using the same normalization options as `renderConfigFileContent`
 * so comparisons line up with how configs are actually written to disk. Throws
 * if the config has conflicting keys that would be dropped.
 */
function canonicalizeConfig(config: Config): NormalizedConfig {
  const droppedKeys: string[] = [];
  const normalized = normalize(config, {
    onDotIntoNonObject: "ignore",
    onDotIntoNull: "empty-object",
    droppedKeys,
  });
  if (droppedKeys.length > 0) {
    throw new Error(`Config update has conflicting keys that would be dropped during normalization: ${droppedKeys.map((key) => JSON.stringify(key)).join(", ")}`);
  }
  return normalized;
}

function configsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => configsEqual(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aEntries = Object.entries(a);
    const bMap = new Map(Object.entries(b));
    if (aEntries.length !== bMap.size) return false;
    return aEntries.every(([key, value]) => bMap.has(key) && configsEqual(value, bMap.get(key)));
  }
  return false;
}
