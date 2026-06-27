import { evalConfigFileContent } from "@hexclave/shared/dist/config-eval";
import type { Config, ConfigValue, NormalizedConfig } from "@hexclave/shared/dist/config/format";
import { normalize, override } from "@hexclave/shared/dist/config/format";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { buildCompleteConfigAgentPrompt, buildPartialConfigAgentPrompt, ClaudeAgentFailureError, ClaudeAgentTimeoutError, CONFIG_AGENT_FILE_TOOLS, getToolWriteTargetPath, isPathInsideDir, runHeadlessClaudeAgent } from "./config-agent";
import { ensureConfigFileExists, readConfigFile } from "./config-file";

const LOG_PREFIX = "[Hexclave config updater]";
const DEFAULT_AGENT_TIMEOUT_MS = 120_000;
const CONFIG_UPDATE_LOG_PATH_LIMIT = 40;
const AGENT_OUTPUT_LOG_MAX_LENGTH = 20_000;

type ConfigFileSnapshot = { path: string, content: string | null };
type ConfigChange = { path: string, value: ConfigValue };

function formatConfigUpdaterErrorForLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }
  return {
    errorMessage: String(error),
  };
}

function configUpdatePathDetailsForLog(changes: ConfigChange[]): Record<string, unknown> {
  const paths = changes.map(({ path: configPath }) => configPath).sort();
  return {
    configUpdatePathCount: paths.length,
    configUpdatePaths: paths.slice(0, CONFIG_UPDATE_LOG_PATH_LIMIT),
    configUpdatePathsTruncated: paths.length > CONFIG_UPDATE_LOG_PATH_LIMIT,
  };
}

function appendBoundedAgentOutput(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  if (next.length <= AGENT_OUTPUT_LOG_MAX_LENGTH) {
    return next;
  }
  return next.slice(next.length - AGENT_OUTPUT_LOG_MAX_LENGTH);
}

function stringifyAgentMessageForLog(message: unknown): string {
  try {
    return `${JSON.stringify(message)}\n`;
  } catch {
    return `${String(message)}\n`;
  }
}

function agentOutputDetailsForLog(agentStdout: string, agentStderr: string): Record<string, unknown> {
  return {
    agentStdout,
    agentStdoutTruncated: agentStdout.length >= AGENT_OUTPUT_LOG_MAX_LENGTH,
    agentStderr,
    agentStderrTruncated: agentStderr.length >= AGENT_OUTPUT_LOG_MAX_LENGTH,
  };
}

export async function updateConfigObject(configFilePath: string, configUpdate: Config): Promise<void> {
  const startedAtMs = performance.now();
  ensureConfigFileExists(configFilePath);

  const changes = flattenConfigUpdate(configUpdate);
  if (changes.length === 0) {
    console.log(`${LOG_PREFIX} Skipping config update because it contains no changes`, {
      configFilePath,
    });
    return;
  }
  const updateLogDetails = {
    configFilePath,
    ...configUpdatePathDetailsForLog(changes),
  };
  console.log(`${LOG_PREFIX} Starting config file update`, updateLogDetails);

  const content = readFileSync(configFilePath, "utf-8");

  // One write path, always: hand the change to the AI agent so it edits the file
  // in place and preserves its authoring (helper wrappers, imports, comments,
  // layout). There is deliberately no deterministic "fast path" — re-rendering a
  // config would flatten and destroy hand-authored files. Reads use jiti
  // (see readConfigFile); writes go through the agent.
  console.log(`${LOG_PREFIX} Applying config update with agent-assisted rewrite`, {
    ...updateLogDetails,
    configDirectory: path.dirname(configFilePath),
  });
  const baselineConfig = await tryReadConfigForValidation(configFilePath);
  const { snapshots, seen } = snapshotConfigFiles(configFilePath, content);
  try {
    await runConfigUpdateAgent({
      prompt: buildConfigUpdatePrompt(path.basename(configFilePath), configUpdate, baselineConfig),
      cwd: path.dirname(configFilePath),
      onFileWillChange: (filePath) => captureSnapshotIfAbsent(snapshots, filePath, seen),
    });
    await validateAgentUpdate(configFilePath, baselineConfig, configUpdate);
  } catch (error) {
    console.warn(`${LOG_PREFIX} Config update failed; restoring files from snapshots`, {
      ...updateLogDetails,
      snapshotCount: snapshots.length,
      elapsedMs: Math.round(performance.now() - startedAtMs),
      ...formatConfigUpdaterErrorForLog(error),
    });
    try {
      restoreConfigFiles(snapshots);
      console.warn(`${LOG_PREFIX} Restored files after failed config update`, {
        ...updateLogDetails,
        snapshotCount: snapshots.length,
      });
    } catch (restoreError) {
      console.error(`${LOG_PREFIX} Failed to fully roll back config files after a failed update of ${configFilePath}; some files may be left in a partially-restored state`, {
        configFilePath,
        ...formatConfigUpdaterErrorForLog(restoreError),
      });
    }
    throw error;
  }
  console.log(`${LOG_PREFIX} Finished config update with agent-assisted rewrite`, {
    ...updateLogDetails,
    elapsedMs: Math.round(performance.now() - startedAtMs),
    snapshotCount: snapshots.length,
  });
}

async function runConfigUpdateAgent(options: {
  prompt: string,
  cwd: string,
  onFileWillChange?: (filePath: string) => void,
}): Promise<void> {
  const timeoutMs = parseAgentTimeoutMs();
  const deniedOutOfBoundsWrites = new Set<string>();
  const startedAtMs = performance.now();
  let agentStdout = "";
  let agentStderr = "";
  console.log(`${LOG_PREFIX} Starting config update agent`, {
    cwd: options.cwd,
    timeoutMs,
  });
  try {
    await runHeadlessClaudeAgent({
      prompt: options.prompt,
      cwd: options.cwd,
      allowedTools: [...CONFIG_AGENT_FILE_TOOLS],
      strictIsolation: true,
      timeoutMs,
      stderr: (data) => {
        agentStderr = appendBoundedAgentOutput(agentStderr, data);
        console.warn(`${LOG_PREFIX} [agent] ${data}`);
      },
      onMessage: (message) => {
        agentStdout = appendBoundedAgentOutput(agentStdout, stringifyAgentMessageForLog(message));
      },
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
      console.warn(`${LOG_PREFIX} Config update agent timed out`, {
        cwd: options.cwd,
        timeoutMs,
        elapsedMs: Math.round(performance.now() - startedAtMs),
        ...formatConfigUpdaterErrorForLog(error),
        ...agentOutputDetailsForLog(agentStdout, agentStderr),
      });
      throw new Error(`Config update agent timed out after ${timeoutMs}ms. It was unable to apply the config changes to the file.`);
    }
    if (error instanceof ClaudeAgentFailureError) {
      console.warn(`${LOG_PREFIX} Config update agent failed`, {
        cwd: options.cwd,
        timeoutMs,
        elapsedMs: Math.round(performance.now() - startedAtMs),
        ...formatConfigUpdaterErrorForLog(error),
        ...agentOutputDetailsForLog(agentStdout, agentStderr),
      });
      throw new Error(`${error.message} It was unable to apply the config changes to the file.`);
    }
    console.warn(`${LOG_PREFIX} Config update agent failed unexpectedly`, {
      cwd: options.cwd,
      timeoutMs,
      elapsedMs: Math.round(performance.now() - startedAtMs),
      ...formatConfigUpdaterErrorForLog(error),
      ...agentOutputDetailsForLog(agentStdout, agentStderr),
    });
    throw error;
  }
  console.log(`${LOG_PREFIX} Finished config update agent`, {
    cwd: options.cwd,
    timeoutMs,
    elapsedMs: Math.round(performance.now() - startedAtMs),
    deniedOutOfBoundsWriteCount: deniedOutOfBoundsWrites.size,
  });
  if (deniedOutOfBoundsWrites.size > 0) {
    console.warn(`${LOG_PREFIX} Config update agent attempted out-of-bounds writes`, {
      cwd: options.cwd,
      deniedOutOfBoundsWriteCount: deniedOutOfBoundsWrites.size,
      deniedOutOfBoundsWrites: [...deniedOutOfBoundsWrites],
    });
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

async function validateAgentUpdate(configFilePath: string, baselineConfig: Config | null, configUpdate: Config): Promise<void> {
  if (baselineConfig != null) {
    const target = canonicalizeConfig(override(baselineConfig, configUpdate));
    const result = canonicalizeConfig((await readConfigFile(configFilePath)).config);
    if (!configsEqual(result, target)) {
      throw new Error(`Config update validation failed for ${configFilePath}: the updated file does not evaluate to the expected configuration.`);
    }
    return;
  }

  // Structural-only fallback when jiti can't evaluate the config (e.g. import-with
  // assets): we can't verify values, only that the file still exports `config`.
  const content = readFileSync(configFilePath, "utf-8");
  if (!configFileExportsConfig(content, configFilePath)) {
    throw new Error(`Config update validation failed for ${configFilePath}: the updated file no longer exports a valid \`config\`.`);
  }
}

function configFileExportsConfig(content: string, configFilePath: string): boolean {
  try {
    evalConfigFileContent(content, configFilePath);
    return true;
  } catch {
    // jiti may fail to resolve imports valid in the user's project but absent
    // here (relative assets, workspace packages). For the structural check we
    // only need a runtime `config` binding to still exist; the agent always
    // authors `export const config`.
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
  const commandPolicy = "Do not run shell commands and do not create files other than what is required to apply the config changes.";
  if (baselineConfig != null) {
    return buildCompleteConfigAgentPrompt({
      scope: { mode: "known-file", configFileName },
      completeConfig: canonicalizeConfig(override(baselineConfig, configUpdate)),
      commandPolicy,
    });
  }
  return buildPartialConfigAgentPrompt({
    configFileName,
    changes,
    commandPolicy,
  });
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
