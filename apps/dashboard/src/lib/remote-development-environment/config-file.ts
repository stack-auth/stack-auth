import "server-only";

import { showOnboardingStackConfigValue } from "@hexclave/shared/dist/config-authoring";
import { Config, isValidConfig } from "@hexclave/shared/dist/config/format";
import { detectImportPackageFromDir, renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { createJiti } from "jiti";
import path from "path";

const jiti = createJiti(import.meta.url, { moduleCache: false });

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
  writeConfigObject(configFilePath, {});
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

export function writeConfigObject(configFilePath: string, config: Config): void {
  const dir = path.dirname(configFilePath);
  mkdirSync(dir, { recursive: true });
  const importPackage = detectImportPackageFromDir(dir);
  const content = renderConfigFileContent(config, importPackage);
  const tempPath = path.join(dir, `.stack.config.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tempPath, content, "utf-8");
  renameSync(tempPath, configFilePath);
}
