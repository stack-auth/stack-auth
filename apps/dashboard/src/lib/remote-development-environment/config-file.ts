import "server-only";

import { showOnboardingStackConfigValue } from "@stackframe/stack-shared/dist/config-authoring";
import { Config, isValidConfig } from "@stackframe/stack-shared/dist/config/format";
import { detectImportPackageFromDir, renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";
import { parseStackConfigFileContent } from "@stackframe/stack-shared/dist/stack-config-file";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";

export function sha256String(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveConfigFilePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  const looksLikeConfigFile = /\.(ts|js|mjs|cjs)$/i.test(resolved);
  return looksLikeConfigFile ? resolved : path.join(resolved, "stack.config.ts");
}

export function ensureConfigFileExists(configFilePath: string): void {
  if (existsSync(configFilePath)) return;
  mkdirSync(path.dirname(configFilePath), { recursive: true });
  writeConfigObject(configFilePath, {});
}

export function readConfigObject(configFilePath: string): Config {
  return readConfigFile(configFilePath).config;
}

export function readConfigFile(configFilePath: string): { config: Config, showOnboarding: boolean } {
  ensureConfigFileExists(configFilePath);
  const content = readFileSync(configFilePath, "utf-8");
  const config = parseStackConfigFileContent(content, configFilePath);
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

export function writeConfigObject(configFilePath: string, config: Config): void {
  const dir = path.dirname(configFilePath);
  mkdirSync(dir, { recursive: true });
  const importPackage = detectImportPackageFromDir(dir);
  const content = renderConfigFileContent(config, importPackage);
  const tempPath = path.join(dir, `.stack.config.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, configFilePath);
}
