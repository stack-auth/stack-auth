import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
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

export function getLocalEmulatorPlaceholderBranchConfigOverride(options: {
  absoluteFilePath: string,
}) {
  return {
    _debug: {
      type: "local-emulator-placeholder-branch-config",
      absoluteFilePath: options.absoluteFilePath,
    },
  };
}
