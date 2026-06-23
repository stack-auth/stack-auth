import { globalPrismaClient } from "@/prisma-client";
import { showOnboardingHexclaveConfigValue } from "@hexclave/shared/dist/config-authoring";
import { detectImportPackageFromDir, renderConfigFileContent } from "@hexclave/shared/dist/config-rendering";
import { isValidConfig } from "@hexclave/shared/dist/config/format";
import { LOCAL_EMULATOR_ADMIN_EMAIL, LOCAL_EMULATOR_ADMIN_PASSWORD } from "@hexclave/shared/dist/local-emulator";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import fs from "fs/promises";
import { createJiti } from "jiti";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const jiti = createJiti(import.meta.url, { moduleCache: false });

export const LOCAL_EMULATOR_ADMIN_USER_ID = "63abbc96-5329-454a-ba56-e0460173c6c1";
export const LOCAL_EMULATOR_OWNER_TEAM_ID = "5a0c858b-d9e9-49d4-9943-8ce385d86428";
export { LOCAL_EMULATOR_ADMIN_EMAIL, LOCAL_EMULATOR_ADMIN_PASSWORD };

export const LOCAL_EMULATOR_ONLY_ENDPOINT_MESSAGE =
  "This endpoint is only available in local emulator mode (set NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true).";
export const LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV = "STACK_LOCAL_EMULATOR_HOST_MOUNT_ROOT";
export const LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE = showOnboardingHexclaveConfigValue;

type LocalEmulatorConfigValue = Record<string, unknown> | typeof LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE;

type ConfigModule = {
  config?: unknown,
};

function isConfigModule(value: unknown): value is ConfigModule {
  return value !== null && typeof value === "object";
}

export function isLocalEmulatorEnabled() {
  return getEnvVariable("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR", "") === "true";
}

export async function isLocalEmulatorProject(projectId: string) {
  if (!isLocalEmulatorEnabled()) {
    return false;
  }

  const project = await globalPrismaClient.localEmulatorProject.findUnique({
    where: {
      projectId,
    },
    select: {
      projectId: true,
    },
  });
  return project !== null;
}

export async function getLocalEmulatorFilePath(projectId: string): Promise<string | null> {
  const result = await globalPrismaClient.localEmulatorProject.findUnique({
    where: { projectId },
    select: { absoluteFilePath: true },
  });
  return result?.absoluteFilePath ?? null;
}

export function resolveEmulatorPath(filePath: string): string {
  const hostMountRoot = getEnvVariable(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, "");
  if (hostMountRoot) {
    return path.join(hostMountRoot, filePath);
  }
  return filePath;
}

async function readConfigContent(filePath: string): Promise<string | null> {
  // Check for base64-encoded config content override from env var
  const envContent = getEnvVariable("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", "");
  if (envContent) {
    return Buffer.from(envContent, "base64").toString("utf-8");
  }
  const resolvedPath = resolveEmulatorPath(filePath);
  try {
    return await fs.readFile(resolvedPath, "utf-8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

async function readConfigValueFromFile(filePath: string): Promise<LocalEmulatorConfigValue> {
  const content = await readConfigContent(filePath);
  if (content == null || content.trim() === "") {
    return {};
  }

  // Determine which file to import: if content came from env var, write a temp
  // file so jiti can import it; otherwise import the file directly from disk.
  const envContent = getEnvVariable("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", "");
  let importPath: string;
  let tempDir: string | null = null;
  if (envContent) {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "hexclave-config-"));
    importPath = path.join(tempDir, "stack.config.ts");
    writeFileSync(importPath, content, "utf-8");
  } else {
    importPath = resolveEmulatorPath(filePath);
  }

  try {
    const configModule = await jiti.import<unknown>(importPath);
    if (!isConfigModule(configModule)) {
      throw new StatusError(StatusError.BadRequest, `Invalid config in ${filePath}. The file must export a plain \`config\` object or "show-onboarding".`);
    }
    const config = configModule.config;
    if (config === showOnboardingHexclaveConfigValue) {
      return LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE;
    }
    if (!isValidConfig(config)) {
      throw new StatusError(StatusError.BadRequest, `Invalid config in ${filePath}. The exported \`config\` is not a valid config object.`);
    }
    return config;
  } catch (e) {
    if (e instanceof StatusError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new StatusError(StatusError.BadRequest, `Error evaluating config in ${filePath}: ${message}`);
  } finally {
    if (tempDir != null) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}

export async function isLocalEmulatorOnboardingEnabledInConfig(filePath: string): Promise<boolean> {
  const config = await readConfigValueFromFile(filePath);
  return config === LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE;
}

export async function readConfigFromFile(filePath: string): Promise<Record<string, unknown>> {
  const config = await readConfigValueFromFile(filePath);
  if (config === LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE) {
    return {};
  }
  return config;
}

export async function writeConfigToFile(filePath: string, config: Record<string, unknown>): Promise<void> {
  const resolvedPath = resolveEmulatorPath(filePath);
  const dir = path.dirname(resolvedPath);
  const hostMountRoot = getEnvVariable(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, "");
  if (hostMountRoot) {
    try {
      await fs.access(dir);
    } catch {
      throw new Error(`Local emulator host mount root ${hostMountRoot} is configured but the parent directory for ${filePath} is not available at ${dir}. Ensure the host filesystem is mounted correctly.`);
    }
  } else {
    await fs.mkdir(dir, { recursive: true });
  }
  const importPackage = detectImportPackageFromDir(dir);
  const content = renderConfigFileContent(config, importPackage);
  await fs.writeFile(resolvedPath, content, "utf-8");
}

export async function writeShowOnboardingConfigToFile(filePath: string): Promise<void> {
  const resolvedPath = resolveEmulatorPath(filePath);
  const dir = path.dirname(resolvedPath);
  const hostMountRoot = getEnvVariable(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, "");
  if (hostMountRoot) {
    try {
      await fs.access(dir);
    } catch {
      throw new Error(`Local emulator host mount root ${hostMountRoot} is configured but the parent directory for ${filePath} is not available at ${dir}. Ensure the host filesystem is mounted correctly.`);
    }
  } else {
    await fs.mkdir(dir, { recursive: true });
  }
  const importPackage = detectImportPackageFromDir(dir) ?? "@hexclave/js";
  const content = `import type { StackConfig } from "${importPackage}";\n\nexport const config: StackConfig = "show-onboarding";\n`;
  await fs.writeFile(resolvedPath, content, "utf-8");
}
