import fs from "fs/promises";
import path from "path";
import { createJiti } from "jiti";
import { isValidConfig } from "@stackframe/stack-shared/dist/config/format";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { globalPrismaClient } from "@/prisma-client";

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

/**
 * Resolves the file path for config files in the local emulator.
 *
 * In the QEMU emulator, the host filesystem is mounted at /host via virtio-9p.
 * The DB stores absolute host paths (e.g. /Users/foo/project/stack.config.ts), so we
 * try /host/<path> first, then fall back to the original path for non-QEMU environments
 * (e.g. Docker Compose where the path is directly accessible).
 */
async function resolveConfigFilePath(filePath: string): Promise<string> {
  const hostMountedPath = path.join("/host", filePath);
  try {
    await fs.access(hostMountedPath);
    return hostMountedPath;
  } catch {
    return filePath;
  }
}

export async function readConfigFromFile(filePath: string): Promise<Record<string, unknown>> {
  const envContent = getEnvVariable("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", "");
  const resolvedPath = envContent ? filePath : await resolveConfigFilePath(filePath);
  const content = envContent
    ? Buffer.from(envContent, "base64").toString("utf-8")
    : await fs.readFile(resolvedPath, "utf-8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });

  if (content === null || content.trim() === "") {
    return {};
  }

  const jiti = createJiti(import.meta.url, { cache: false });
  const mod = jiti.evalModule(content, { filename: resolvedPath }) as Record<string, unknown>;
  const config = mod.config;
  if (!isValidConfig(config)) {
    throw new StatusError(StatusError.BadRequest, `Invalid config in ${filePath}. The file must export a 'config' object.`);
  }
  return config;
}

export async function writeConfigToFile(filePath: string, config: Record<string, unknown>): Promise<void> {
  const resolvedPath = await resolveConfigFilePath(filePath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  const configString = JSON.stringify(config, null, 2);
  const content = `export const config = ${configString};\n`;
  await fs.writeFile(resolvedPath, content, "utf-8");
}

export async function getLocalEmulatorFilePath(projectId: string): Promise<string | null> {
  const project = await globalPrismaClient.localEmulatorProject.findUnique({
    where: { projectId },
    select: { absoluteFilePath: true },
  });
  return project?.absoluteFilePath ?? null;
}
