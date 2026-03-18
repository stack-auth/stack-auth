import { globalPrismaClient } from "@/prisma-client";
import { renderConfigFileContent } from "@stackframe/stack-shared/dist/config-rendering";
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

export async function readConfigFromFile(filePath: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      throw new StatusError(StatusError.BadRequest, `Config file not found: ${filePath}`);
    }
    throw e;
  }
  const jiti = createJiti(import.meta.url, { cache: false });
  const mod = jiti.evalModule(content, { filename: filePath }) as Record<string, unknown>;
  const config = mod.config;
  if (!isValidConfig(config)) {
    throw new StatusError(StatusError.BadRequest, `Invalid config in ${filePath}. The file must export a 'config' object.`);
  }
  return config;
}

export async function writeConfigToFile(filePath: string, config: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const content = renderConfigFileContent(config);
  await fs.writeFile(filePath, content, "utf-8");
}
