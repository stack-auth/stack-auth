import { globalPrismaClient } from "@/prisma-client";
import { detectImportPackageFromDir, renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";
import { isValidConfig } from "@stackframe/stack-shared/dist/config/format";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import fs from "fs/promises";
import { createJiti } from "jiti";
import path from "path";

export const LOCAL_EMULATOR_ADMIN_USER_ID = "63abbc96-5329-454a-ba56-e0460173c6c1";
export const LOCAL_EMULATOR_OWNER_TEAM_ID = "5a0c858b-d9e9-49d4-9943-8ce385d86428";
export const LOCAL_EMULATOR_ADMIN_EMAIL = "local-emulator@stack-auth.com";
export const LOCAL_EMULATOR_ADMIN_PASSWORD = "LocalEmulatorPassword";

export const LOCAL_EMULATOR_ENV_CONFIG_BLOCKED_MESSAGE =
  "Environment configuration overrides cannot be changed in the local emulator. Update this in your production deployment instead.";
export const LOCAL_EMULATOR_ONLY_ENDPOINT_MESSAGE =
  "This endpoint is only available in local emulator mode (set NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true).";
export const LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV = "STACK_LOCAL_EMULATOR_HOST_MOUNT_ROOT";
export const LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE = "show-onboarding" as const;

type LocalEmulatorConfigValue = Record<string, unknown> | typeof LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE;

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

async function readConfigContent(filePath: string): Promise<string> {
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
      return "";
    }
    throw e;
  }
}

async function readConfigValueFromFile(filePath: string): Promise<LocalEmulatorConfigValue> {
  const content = await readConfigContent(filePath);
  if (content.trim() === "") {
    return {};
  }

  const jiti = createJiti(import.meta.url, { cache: false });
  const mod = jiti.evalModule(content, { filename: filePath }) as Record<string, unknown>;
  const config = mod.config;
  if (config === LOCAL_EMULATOR_SHOW_ONBOARDING_VALUE) {
    return config;
  }
  if (!isValidConfig(config)) {
    throw new StatusError(StatusError.BadRequest, `Invalid config in ${filePath}. The file must export a 'config' object or "show-onboarding".`);
  }
  return config;
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
  const importPackage = detectImportPackageFromDir(dir) ?? "@stackframe/js";
  const content = `import type { StackConfig } from "${importPackage}";\n\nexport const config: StackConfig = "show-onboarding";\n`;
  await fs.writeFile(resolvedPath, content, "utf-8");
}
