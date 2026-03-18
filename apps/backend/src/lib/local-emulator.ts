import fs from "fs/promises";
import path from "path";
import { createJiti } from "jiti";
import { isValidConfig } from "@stackframe/stack-shared/dist/config/format";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
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

export async function getLocalEmulatorFilePath(projectId: string): Promise<string | null> {
  const result = await globalPrismaClient.localEmulatorProject.findUnique({
    where: { projectId },
    select: { absoluteFilePath: true },
  });
  return result?.absoluteFilePath ?? null;
}

function getLocalEmulatorFileBridgeConfig() {
  const url = getEnvVariable("STACK_LOCAL_EMULATOR_FILE_BRIDGE_URL", "");
  const token = getEnvVariable("STACK_LOCAL_EMULATOR_FILE_BRIDGE_TOKEN", "");
  if (url === "") {
    return null;
  }
  if (token === "") {
    throw new StackAssertionError("STACK_LOCAL_EMULATOR_FILE_BRIDGE_TOKEN must be set when STACK_LOCAL_EMULATOR_FILE_BRIDGE_URL is configured.");
  }
  return { url, token };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function requestLocalEmulatorFileBridge(pathname: string, body: Record<string, unknown>): Promise<unknown> {
  const bridgeConfig = getLocalEmulatorFileBridgeConfig();
  if (bridgeConfig === null) {
    throw new StackAssertionError("Local emulator file bridge is not configured.");
  }

  const response = await fetch(new URL(pathname, bridgeConfig.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Stack-Emulator-Token": bridgeConfig.token,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new StackAssertionError(`Local emulator file bridge request failed: ${response.status} ${responseText || response.statusText}`);
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new StackAssertionError(`Local emulator file bridge returned invalid JSON for ${pathname}.`);
  }
}

export async function readConfigFileContentIfExists(filePath: string): Promise<string | null> {
  const bridgeConfig = getLocalEmulatorFileBridgeConfig();
  if (bridgeConfig !== null) {
    const responseJson = await requestLocalEmulatorFileBridge("/read", { path: filePath });
    if (!isObject(responseJson) || typeof responseJson.exists !== "boolean") {
      throw new StackAssertionError("Local emulator file bridge returned an invalid read response.", { responseJson });
    }
    if (!responseJson.exists) {
      return null;
    }
    if (typeof responseJson.content !== "string") {
      throw new StackAssertionError("Local emulator file bridge read response is missing file content.", { responseJson });
    }
    return responseJson.content;
  }

  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeConfigFileContent(filePath: string, content: string): Promise<void> {
  const bridgeConfig = getLocalEmulatorFileBridgeConfig();
  if (bridgeConfig !== null) {
    const responseJson = await requestLocalEmulatorFileBridge("/write", { path: filePath, content });
    if (!isObject(responseJson) || responseJson.ok !== true) {
      throw new StackAssertionError("Local emulator file bridge returned an invalid write response.", { responseJson });
    }
    return;
  }

  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export async function readConfigFromFile(filePath: string): Promise<Record<string, unknown>> {
  const content = await readConfigFileContentIfExists(filePath);
  if (content === null) {
    throw new StatusError(StatusError.BadRequest, `Config file not found: ${filePath}`);
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
  const content = `export const config = ${JSON.stringify(config, null, 2)};\n`;
  await writeConfigFileContent(filePath, content);
}
