import { Prisma } from "@/generated/prisma/client";
import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const DEVELOPMENT_ENVIRONMENT_ENV_CONFIG_BLOCKED_MESSAGE =
  "Environment configuration overrides cannot be changed in a development environment. Update this in your production deployment instead.";

export type ConfigOverrideWriteLevel = "project" | "branch" | "environment";

export async function isDevelopmentEnvironmentProject(projectId: string): Promise<boolean> {
  const rows = await globalPrismaClient.$replica().$queryRaw<Array<{ isDevelopmentEnvironment: boolean }>>(Prisma.sql`
    SELECT "isDevelopmentEnvironment"
    FROM "Project"
    WHERE "id" = ${projectId}
    LIMIT 1
  `);
  return rows[0]?.isDevelopmentEnvironment === true;
}

export async function getEnvironmentConfigWriteBlockReason(projectId: string): Promise<string | null> {
  return await isDevelopmentEnvironmentProject(projectId)
    ? DEVELOPMENT_ENVIRONMENT_ENV_CONFIG_BLOCKED_MESSAGE
    : null;
}

export async function getConfigOverrideWriteBlockReason(level: ConfigOverrideWriteLevel, projectId: string): Promise<string | null> {
  if (level !== "environment") {
    return null;
  }
  return await getEnvironmentConfigWriteBlockReason(projectId);
}

export async function assertConfigOverrideWriteAllowed(level: ConfigOverrideWriteLevel, projectId: string): Promise<void> {
  const blockReason = await getConfigOverrideWriteBlockReason(level, projectId);
  if (blockReason != null) {
    throw new StatusError(StatusError.BadRequest, blockReason);
  }
}
