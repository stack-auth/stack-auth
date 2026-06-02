import "server-only";

import { showOnboardingStackConfigValue } from "@hexclave/shared/dist/config-authoring";
import { Config, ConfigValue, NormalizedConfig, isValidConfig, normalize, override } from "@hexclave/shared/dist/config/format";
import { detectImportPackageFromDir, renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import { getRelativeImportSpecifiers, stackConfigFileExportsConfig, tryParseStackConfigFileContent } from "@hexclave/shared/dist/stack-config-file";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
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
 * Renders a config object to its canonical, lossy source text (a single
 * `export const config = { ...JSON... }`). It does not preserve imports, helper
 * wrappers, comments, or external file references, so only render this for a
 * file that has no existing structure to preserve (a brand-new/empty file, or a
 * plain static literal). Otherwise use {@link updateConfigObject}.
 */
function renderConfigObjectToString(configFilePath: string, config: Config): string {
  const importPackage = detectImportPackageFromDir(path.dirname(configFilePath));
  return renderConfigFileContent(config, importPackage);
}

/** Writes `content` to `configFilePath` atomically (write to temp, then rename). */
function writeFileAtomic(configFilePath: string, content: string): void {
  const dir = path.dirname(configFilePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.stack.config.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, configFilePath);
}

/** Renders `config` to its canonical source text and writes it to disk, overwriting the file. */
function renderConfigObjectToFile(configFilePath: string, config: Config): void {
  writeFileAtomic(configFilePath, renderConfigObjectToString(configFilePath, config));
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

  // Nothing to do when there are no leaf changes (e.g. `{}` or `{ foo: undefined }`).
  if (flattenConfigUpdate(configUpdate).length === 0) return;

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
    // Validate the exact bytes we are about to write *before* touching the file,
    // so a bad render can never leave the user's config in a broken state.
    const rendered = renderConfigObjectToString(configFilePath, target);
    const written = tryParseStackConfigFileContent(rendered, configFilePath);
    if (written == null || written === showOnboardingStackConfigValue || !isValidConfig(written) || !configsEqual(canonicalizeConfig(written), canonicalizeConfig(target))) {
      throw new Error(`Config update validation failed for ${configFilePath}: the regenerated file does not match the expected configuration.`);
    }
    writeFileAtomic(configFilePath, rendered);
    return;
  }

  // Custom structure: capture an evaluable baseline if we can (so we can do a
  // full semantic check afterwards), then let the agent apply the change.
  const baselineConfig = await tryReadConfigForValidation(configFilePath);

  // Snapshot the config file and its statically-referenced imports up front, then
  // additionally capture any file the agent is about to write *before* it writes
  // (via `onFileWillChange`). Together these let us roll back to the exact
  // original state if the agent fails or its result doesn't validate — including
  // brand-new files and files the agent edits that weren't statically imported —
  // so we never leave a half-applied update behind.
  const snapshots = snapshotConfigFiles(configFilePath, content);
  try {
    await runConfigUpdateAgent({
      prompt: buildConfigUpdatePrompt(path.basename(configFilePath), configUpdate),
      cwd: path.dirname(configFilePath),
      onFileWillChange: (filePath) => captureSnapshotIfAbsent(snapshots, filePath),
    });
    await validateAgentUpdate(configFilePath, baselineConfig, configUpdate, snapshots);
  } catch (error) {
    restoreConfigFiles(snapshots);
    throw error;
  }
}

/** A captured file state used for rollback. `content` is `null` if the file did not exist. */
type ConfigFileSnapshot = { path: string, content: string | null };

/**
 * Captures a file's current on-disk content into `snapshots` (recording `null`
 * if it doesn't exist) unless it's already captured. Paths are resolved to
 * absolute form so the same file is never snapshotted twice under different
 * spellings. Files are read as UTF-8 text, which matches this feature's
 * text-import use case.
 */
function captureSnapshotIfAbsent(snapshots: ConfigFileSnapshot[], filePath: string): void {
  const resolved = path.resolve(filePath);
  if (snapshots.some((snapshot) => snapshot.path === resolved)) return;
  snapshots.push({ path: resolved, content: existsSync(resolved) ? readFileSync(resolved, "utf-8") : null });
}

/**
 * Seeds the rollback set with the config file plus every file it imports via a
 * relative path (e.g. `import x from "./welcome-email.tsx" with { type: "text" }`),
 * which are exactly the files an in-place update is expected to touch. Any other
 * file the agent ends up writing is captured on the fly via `onFileWillChange`,
 * so this static pass is just a best-effort head start, not the full guarantee.
 */
function snapshotConfigFiles(configFilePath: string, configContent: string): ConfigFileSnapshot[] {
  const dir = path.dirname(configFilePath);
  const snapshots: ConfigFileSnapshot[] = [{ path: path.resolve(configFilePath), content: configContent }];
  for (const specifier of getRelativeImportSpecifiers(configContent)) {
    captureSnapshotIfAbsent(snapshots, path.resolve(dir, specifier));
  }
  return snapshots;
}

function restoreConfigFiles(snapshots: ConfigFileSnapshot[]): void {
  for (const { path: filePath, content } of snapshots) {
    if (content === null) {
      if (existsSync(filePath)) rmSync(filePath);
    } else {
      writeFileSync(filePath, content, "utf-8");
    }
  }
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

async function validateAgentUpdate(configFilePath: string, baselineConfig: Config | null, configUpdate: Config, snapshots: ConfigFileSnapshot[]): Promise<void> {
  if (baselineConfig != null) {
    const target = canonicalizeConfig(override(baselineConfig, configUpdate));
    const result = canonicalizeConfig((await readConfigFile(configFilePath)).config);
    if (!configsEqual(result, target)) {
      throw new Error(`Config update validation failed for ${configFilePath}: the updated file does not evaluate to the expected configuration.`);
    }
    return;
  }

  // The config couldn't be evaluated (e.g. it imports external text files), so a
  // full semantic comparison isn't possible. We make the weaker checks we can:

  // 1. The agent must have actually written something. If a non-empty update
  //    left every file we snapshotted byte-for-byte unchanged, the agent didn't
  //    apply the change (e.g. it couldn't find the referenced file) — fail loud
  //    rather than report a success that did nothing.
  if (flattenConfigUpdate(configUpdate).length > 0 && !snapshotsChangedOnDisk(snapshots)) {
    throw new Error(`Config update validation failed for ${configFilePath}: the agent did not modify the config or any of its referenced files.`);
  }

  // 2. The file must still be syntactically valid and export `config`.
  const content = readFileSync(configFilePath, "utf-8");
  if (!stackConfigFileExportsConfig(content, configFilePath)) {
    throw new Error(`Config update validation failed for ${configFilePath}: the updated file no longer exports a valid \`config\`.`);
  }
}

/**
 * Returns whether any snapshotted file's current on-disk content differs from
 * what it was when captured (including being created or deleted). Used to detect
 * a no-op agent run when the config isn't evaluable enough for a semantic check.
 */
function snapshotsChangedOnDisk(snapshots: ConfigFileSnapshot[]): boolean {
  return snapshots.some(({ path: filePath, content }) => {
    const current = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
    return current !== content;
  });
}

type ConfigChange = { path: string, value: ConfigValue };

/**
 * Flattens a (possibly dot-notation) config update into individual leaf changes,
 * so the agent gets an explicit list of which config paths to set. Arrays,
 * primitives, and empty objects are leaves; nested non-empty plain objects are
 * walked.
 *
 * `undefined` values are skipped, matching `override` (which filters them out as
 * a no-op rather than treating them as removals); emitting removals here would
 * diverge from the configuration the update is validated against.
 */
function flattenConfigUpdate(update: Config): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const walk = (prefix: string, obj: Config): void => {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix === "" ? key : `${prefix}.${key}`;
      if (value === undefined) continue;
      // An empty object is a leaf value (an explicit `{}`); only recurse into
      // objects that actually have keys.
      if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
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
    // Both the path and value come from the (untrusted) config update, so they're
    // JSON-encoded rather than interpolated raw — this escapes backticks, quotes,
    // and newlines that could otherwise break out of the prompt's formatting or
    // inject extra instructions.
    return `- ${JSON.stringify(configPath)}: set to ${JSON.stringify(value)}`;
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
