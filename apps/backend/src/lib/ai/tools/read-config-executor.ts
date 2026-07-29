import { getRenderedBranchConfigQuery } from "@/lib/config";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { captureError } from "@hexclave/shared/dist/utils/errors";

export const READ_CONFIG_RESULT_MAX_CHARS = 50_000;

export async function readRenderedConfig(projectId: string, branchId: string = DEFAULT_BRANCH_ID) {
  try {
    const config = await rawQuery(globalPrismaClient, getRenderedBranchConfigQuery({ projectId, branchId }));
    const serialized = JSON.stringify(config);
    if (serialized.length > READ_CONFIG_RESULT_MAX_CHARS) {
      return {
        success: false as const,
        error:
          `The project config is too large to return in full (${serialized.length} characters, limit ${READ_CONFIG_RESULT_MAX_CHARS}). ` +
          `Ask the user about the specific part of the configuration you need (eg. apps, auth, rbac, teams, payments) so it can be inspected directly instead.`,
      };
    }
    return {
      success: true as const,
      config,
    };
  } catch (error) {
    captureError("ai-tool-read-config", error);
    return {
      success: false as const,
      error: "Failed to read the project config. Please try again.",
    };
  }
}
