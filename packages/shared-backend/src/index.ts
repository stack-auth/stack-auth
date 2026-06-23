import { showOnboardingHexclaveConfigValue } from "@hexclave/shared/dist/config-authoring";
import { detectImportPackageFromDir, parseHexclaveConfigFileContent, renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import type { Config, ConfigValue, NormalizedConfig } from "@hexclave/shared/dist/config/format";
import { isValidConfig, normalize, override } from "@hexclave/shared/dist/config/format";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { createJiti } from "jiti";
import path from "path";
import { ClaudeAgentFailureError, ClaudeAgentTimeoutError, getToolWriteTargetPath, isPathInsideDir, runHeadlessClaudeAgent } from "./config-agent";

const jiti = createJiti(import.meta.url, { moduleCache: false });

const LOG_PREFIX = "[Stack config updater]";
const DEFAULT_AGENT_TIMEOUT_MS = 120_000;

type ConfigModule = {
  config?: unknown,
};

type ConfigFileSnapshot = { path: string, content: string | null };
type ConfigChange = { path: string, value: ConfigValue };

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
  // Prefer hexclave.config.ts, fall back to stack.config.ts, default to the new name.
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

  let configModule: unknown;
  try {
    configModule = await jiti.import<unknown>(configFilePath);
  } catch (error) {
    // Capture the raw jiti/framework error for diagnostics, but don't attach it as `cause` on the thrown error:
    // dashboard error formatting renders causes recursively, which would leak framework internals into the
    // user-facing message we're deliberately replacing.
    captureError("shared-backend/readConfigFile", error);
    throw new Error(
      `Failed to load config file ${configFilePath}.`,
    );
  }
  if (!isConfigModule(configModule)) {
    throw new Error(`Invalid config in ${configFilePath}. The file must export a plain \`config\` object or "show-onboarding".`);
  }

  const config = configModule.config;
  if (config === showOnboardingHexclaveConfigValue) {
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

function renderConfigObjectToString(configFilePath: string, config: Config): string {
  const importPackage = detectImportPackageFromDir(path.dirname(configFilePath));
  return renderConfigFileContent(config, importPackage);
}

function writeFileAtomic(configFilePath: string, content: string): void {
  const dir = path.dirname(configFilePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.stack.config.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  try {
    renameSync(tempPath, configFilePath);
  } catch (error) {
    try {
      rmSync(tempPath);
    } catch { /* best-effort cleanup */ }
    throw error;
  }
}

function renderConfigObjectToFile(configFilePath: string, config: Config): void {
  writeFileAtomic(configFilePath, renderConfigObjectToString(configFilePath, config));
}

export async function updateConfigObject(configFilePath: string, configUpdate: Config): Promise<void> {
  ensureConfigFileExists(configFilePath);

  if (flattenConfigUpdate(configUpdate).length === 0) return;

  const content = readFileSync(configFilePath, "utf-8");

  // Fast path: if the config is a plain static literal (no imports, no helpers),
  // apply the update deterministically without invoking the AI agent.
  const staticConfig = tryParseStaticConfigFileContent(content, configFilePath);
  if (staticConfig != null && isValidConfig(staticConfig)) {
    const merged = override(staticConfig, configUpdate);
    if (!isValidConfig(merged)) {
      throw new Error(`${LOG_PREFIX} Merged config is invalid after applying update to ${configFilePath}`);
    }
    renderConfigObjectToFile(configFilePath, merged);
    return;
  }

  // Agent path: config has custom structure (imports, helpers, external files)
  // that must be preserved — delegate to the AI agent.
  const baselineConfig = await tryReadConfigForValidation(configFilePath);
  const { snapshots, seen } = snapshotConfigFiles(configFilePath, content);
  try {
    await runConfigUpdateAgent({
      prompt: buildConfigUpdatePrompt(path.basename(configFilePath), configUpdate, baselineConfig),
      cwd: path.dirname(configFilePath),
      onFileWillChange: (filePath) => captureSnapshotIfAbsent(snapshots, filePath, seen),
    });
    await validateAgentUpdate(configFilePath, baselineConfig, configUpdate, snapshots);
  } catch (error) {
    try {
      restoreConfigFiles(snapshots);
    } catch (restoreError) {
      console.error(`${LOG_PREFIX} Failed to fully roll back config files after a failed update of ${configFilePath}; some files may be left in a partially-restored state`, {
        configFilePath,
        restoreError: restoreError instanceof Error ? restoreError.message : String(restoreError),
      });
    }
    throw error;
  }
}

export async function replaceConfigObject(configFilePath: string, config: Config): Promise<void> {
  renderConfigObjectToFile(configFilePath, config);
}

async function runConfigUpdateAgent(options: {
  prompt: string,
  cwd: string,
  onFileWillChange?: (filePath: string) => void,
}): Promise<void> {
  const timeoutMs = parseAgentTimeoutMs();
  const deniedOutOfBoundsWrites = new Set<string>();
  try {
    await runHeadlessClaudeAgent({
      prompt: options.prompt,
      cwd: options.cwd,
      allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
      strictIsolation: true,
      timeoutMs,
      stderr: (data) => { console.warn(`${LOG_PREFIX} [agent] ${data}`); },
      onPreToolUse: (input) => {
        const target = getToolWriteTargetPath(input.tool_name, input.tool_input, options.cwd);
        if (target == null) return { continue: true };
        if (!isPathInsideDir(options.cwd, target)) {
          deniedOutOfBoundsWrites.add(target);
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `Refusing to modify ${target}: config updates may only change files inside the config directory.`,
            },
          };
        }
        options.onFileWillChange?.(target);
        return { continue: true };
      },
    });
  } catch (error) {
    if (error instanceof ClaudeAgentTimeoutError) {
      throw new Error(`Config update agent timed out after ${timeoutMs}ms. It was unable to apply the config changes to the file.`);
    }
    if (error instanceof ClaudeAgentFailureError) {
      throw new Error(`${error.message} It was unable to apply the config changes to the file.`);
    }
    throw error;
  }
  if (deniedOutOfBoundsWrites.size > 0) {
    throw new Error(`Config update agent tried to modify ${deniedOutOfBoundsWrites.size} file(s) outside the config directory, which is not allowed: ${[...deniedOutOfBoundsWrites].join(", ")}. The config was not updated.`);
  }
}

function parseAgentTimeoutMs(): number {
  const raw = process.env.STACK_CONFIG_UPDATE_AGENT_TIMEOUT_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_AGENT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid STACK_CONFIG_UPDATE_AGENT_TIMEOUT_MS: ${JSON.stringify(raw)}. Expected a positive number of milliseconds.`);
  }
  return parsed;
}

function captureSnapshotIfAbsent(snapshots: ConfigFileSnapshot[], filePath: string, seen: Set<string>): void {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved)) return;
  seen.add(resolved);
  snapshots.push({ path: resolved, content: existsSync(resolved) ? readFileSync(resolved, "utf-8") : null });
}

function snapshotConfigFiles(configFilePath: string, configContent: string): { snapshots: ConfigFileSnapshot[]; seen: Set<string> } {
  const dir = path.dirname(configFilePath);
  const resolvedConfig = path.resolve(configFilePath);
  const snapshots: ConfigFileSnapshot[] = [{ path: resolvedConfig, content: configContent }];
  const seen = new Set<string>([resolvedConfig]);
  for (const specifier of getRelativeImportSpecifiers(configContent)) {
    const resolved = path.resolve(dir, specifier);
    if (!isPathInsideDir(dir, resolved)) continue;
    captureSnapshotIfAbsent(snapshots, resolved, seen);
  }
  return { snapshots, seen };
}

function restoreConfigFiles(snapshots: ConfigFileSnapshot[]): void {
  const failures: string[] = [];
  for (const { path: filePath, content } of snapshots) {
    try {
      if (content === null) {
        if (existsSync(filePath)) rmSync(filePath);
      } else {
        writeFileSync(filePath, content, "utf-8");
      }
    } catch (error) {
      failures.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Failed to restore ${failures.length} file(s) during rollback: ${failures.join("; ")}`);
  }
}

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

  // Structural-only fallback: when jiti can't evaluate the config (e.g. missing
  // runtime dependencies in import-with attributes), we can only verify that
  // (a) something changed on disk and (b) the file still exports `config`.
  // This cannot catch silently mis-applied values — an accepted tradeoff vs.
  // blocking updates entirely for configs we can't evaluate.
  // When nothing changed on disk the update is either already applied or the
  // agent couldn't figure out what to do. Treat it as a no-op rather than a
  // hard failure: the structural check below still verifies the file is valid.
  if (flattenConfigUpdate(configUpdate).length > 0 && !snapshotsChangedOnDisk(snapshots)) {
    console.warn(`${LOG_PREFIX} Agent did not modify any file for ${configFilePath}; assuming values are already up to date.`);
  }

  const content = readFileSync(configFilePath, "utf-8");
  if (!configFileExportsConfig(content, configFilePath)) {
    throw new Error(`Config update validation failed for ${configFilePath}: the updated file no longer exports a valid \`config\`.`);
  }
}

function tryParseStaticConfigFileContent(content: string, configFilePath: string): Config | null {
  try {
    const parsed = parseHexclaveConfigFileContent(content, configFilePath);
    return isValidConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function configFileExportsConfig(content: string, configFilePath: string): boolean {
  try {
    parseHexclaveConfigFileContent(content, configFilePath);
    return true;
  } catch {
    // Dynamic configs can be valid even when the static parser cannot evaluate
    // them. For the structural fallback we only need to know that a runtime
    // config binding still exists after the agent edited the file.
    return /\bexport\s+const\s+config\b/.test(content);
  }
}

function getRelativeImportSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /\bimport\b(?:[^'"]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(content)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

function snapshotsChangedOnDisk(snapshots: ConfigFileSnapshot[]): boolean {
  return snapshots.some(({ path: filePath, content }) => {
    const current = existsSync(filePath) ? readFileSync(filePath, "utf-8") : null;
    return current !== content;
  });
}

function flattenConfigUpdate(update: Config): ConfigChange[] {
  const changes: ConfigChange[] = [];
  const walk = (prefix: string, obj: Config): void => {
    for (const [key, value] of Object.entries(obj)) {
      const fullPath = prefix === "" ? key : `${prefix}.${key}`;
      if (value === undefined) continue;
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

function buildConfigUpdatePrompt(configFileName: string, configUpdate: Config, baselineConfig: Config | null): string {
  const changes = flattenConfigUpdate(configUpdate);
  const changeLines = changes.map(({ path: configPath, value }) => {
    return `- ${JSON.stringify(configPath)}: set to ${JSON.stringify(value)}`;
  }).join("\n");
  const expectedConfig = baselineConfig == null ? null : canonicalizeConfig(override(baselineConfig, configUpdate));
  const expectedConfigSection = expectedConfig == null ? "" : `
After the edit, evaluating the exported \`config\` must produce this exact JSON value:

${JSON.stringify(expectedConfig, null, 2)}
`;

  return `You are editing a Hexclave / Stack Auth configuration file in place. Apply a set of configuration changes WITHOUT changing how the file is written.

Config file: ${JSON.stringify(configFileName)} (in the current working directory).

The file exports a \`config\` object (it may be wrapped in a helper such as \`defineStackConfig(...)\`). Some config values may be sourced from other files via imports, for example:

    import welcomeEmail from "./welcome-email.tsx" with { type: "text" };
    export const config = { emails: { templates: { welcome: welcomeEmail } } };

Apply EXACTLY these changes. Paths use dot notation, so \`a.b.c\` refers to \`config.a.b.c\`:

${changeLines}
${expectedConfigSection}

Rules:
- Change ONLY the config paths listed above. Leave every other part of the file byte-for-byte unchanged: imports, comments, formatting, helper wrappers, and any config fields not listed.
- If a listed path's value is currently provided by an imported external file (like the \`import ... with { type: "text" }\` example above), DO NOT inline the new value into the config file. Instead, overwrite that external file with the new value and keep the import statement intact.
- If a listed path's value is a plain inline literal, edit it inline.
- Keep the file valid: it must still export a \`config\` that, once evaluated, reflects the new values exactly.
- Do not run any shell commands and do not create files other than what is required to apply these changes.`;
}

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
