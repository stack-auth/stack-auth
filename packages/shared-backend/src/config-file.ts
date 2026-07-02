import { showOnboardingHexclaveConfigValue } from "@hexclave/shared/dist/config-authoring";
import { ConfigFileEvalError, detectImportPackageFromDir, evalConfigFileContent } from "@hexclave/shared/dist/config-eval";
import { renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import type { Config } from "@hexclave/shared/dist/config/format";
import { isValidConfig } from "@hexclave/shared/dist/config/format";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";

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

  // ConfigFileEvalError => "Invalid config"; any other loader error is captured
  // for diagnostics but not attached as `cause` (the dashboard renders causes
  // recursively and would leak framework internals).
  let parsed: ReturnType<typeof evalConfigFileContent>;
  try {
    parsed = evalConfigFileContent(content, configFilePath);
  } catch (error) {
    if (error instanceof ConfigFileEvalError) {
      throw new Error(`Invalid config in ${configFilePath}.`);
    }
    captureError("shared-backend/readConfigFile", error);
    throw new Error(`Failed to load config file ${configFilePath}.`);
  }

  if (parsed === showOnboardingHexclaveConfigValue) {
    return {
      config: {},
      showOnboarding: true,
    };
  }
  if (!isValidConfig(parsed)) {
    throw new Error(`Invalid config in ${configFilePath}.`);
  }
  return {
    config: parsed,
    showOnboarding: false,
  };
}

export async function replaceConfigObject(configFilePath: string, config: Config): Promise<void> {
  renderConfigObjectToFile(configFilePath, config);
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
