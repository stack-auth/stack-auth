import fs from "fs/promises";
import path from "path";
import { createJiti } from "jiti";
import { isValidConfig } from "@stackframe/stack-shared/dist/config/format";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { globalPrismaClient } from "@/prisma-client";

export const LOCAL_EMULATOR_INTERNAL_PUBLISHABLE_CLIENT_KEY = "local-emulator-publishable-client-key";
export const LOCAL_EMULATOR_INTERNAL_SECRET_SERVER_KEY = "local-emulator-secret-server-key";
export const LOCAL_EMULATOR_INTERNAL_SUPER_SECRET_ADMIN_KEY = "local-emulator-super-secret-admin-key";

export const LOCAL_EMULATOR_ADMIN_USER_ID = "63abbc96-5329-454a-ba56-e0460173c6c1";
export const LOCAL_EMULATOR_OWNER_TEAM_ID = "5a0c858b-d9e9-49d4-9943-8ce385d86428";
export const LOCAL_EMULATOR_ADMIN_EMAIL = "local-emulator@stack-auth.com";
export const LOCAL_EMULATOR_ADMIN_PASSWORD = "LocalEmulatorPassword";

export const LOCAL_EMULATOR_ENV_CONFIG_BLOCKED_MESSAGE =
  "Environment configuration overrides cannot be changed in the local emulator. Update this in your production deployment instead.";
export const LOCAL_EMULATOR_ONLY_ENDPOINT_MESSAGE =
  "This endpoint is only available in local emulator mode (set NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR=true).";
export const LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV = "STACK_LOCAL_EMULATOR_HOST_MOUNT_ROOT";

export function isLocalEmulatorEnabled() {
  return getEnvVariable("NEXT_PUBLIC_STACK_IS_LOCAL_EMULATOR", "") === "true";
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Resolves the file path for config files in the local emulator.
 *
 * In the QEMU emulator, the host filesystem is mounted separately at /host, outside the
 * guest qcow2 overlay. The DB stores absolute host paths (for example
 * /Users/foo/project/stack.config.ts), so we map them to /host/<path> when the host mount
 * is configured. We fail loudly if the host mount root is configured but inaccessible,
 * because silently writing to a guest-local lookalike path would desync the dashboard from
 * the user's real stack.config.ts file.
 */
async function resolveConfigFilePath(filePath: string): Promise<string> {
  const hostMountRoot = getEnvVariable(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, "");
  if (hostMountRoot !== "") {
    const hostMountedPath = path.join(hostMountRoot, filePath);
    if (await pathExists(hostMountedPath) || await pathExists(path.dirname(hostMountedPath))) {
      return hostMountedPath;
    }

    throw new Error(
      `Local emulator host mount root ${hostMountRoot} is configured, but ${hostMountedPath} is not accessible. ` +
      "Restart the QEMU emulator so the host share is mounted, or choose a config path under the shared host root."
    );
  }

  return filePath;
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
  const mod = jiti.evalModule(content, { filename: resolvedPath });
  const invalidConfigMessage = `Invalid config in ${filePath}. The file must export a 'config' object.`;
  if (typeof mod !== "object" || mod === null || !("config" in mod)) {
    throw new StatusError(StatusError.BadRequest, invalidConfigMessage);
  }
  const config = mod.config;
  if (!isValidConfig(config)) {
    throw new StatusError(StatusError.BadRequest, invalidConfigMessage);
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
