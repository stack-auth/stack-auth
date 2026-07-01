import { getRenderedBranchConfigQuery } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { SmartRequestAuth } from "@/route-handlers/smart-request";
import { DEFAULT_BRANCH_ID } from "@/lib/tenancies";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { tool } from "ai";
import { z } from "zod";

/**
 * Resolves the project/branch whose config should be read. Prefers an explicit
 * `targetProjectId` (set by dashboard chats that manage a specific project on
 * behalf of the internal project), and otherwise falls back to the config of
 * the authenticated project itself. Returns `null` when no concrete project can
 * be resolved (eg. the docs assistant, which has no project context).
 */
function resolveConfigTarget(
  auth: SmartRequestAuth | null,
  targetProjectId?: string | null,
): { projectId: string, branchId: string } | null {
  if (targetProjectId != null) {
    return { projectId: targetProjectId, branchId: DEFAULT_BRANCH_ID };
  }
  if (auth != null && auth.project.id !== "internal") {
    return { projectId: auth.project.id, branchId: auth.branchId };
  }
  return null;
}

/**
 * Creates a tool that returns the rendered branch config object — the same
 * configuration that is usually stored in the project's `hexclave.config.ts`
 * file (auth settings, installed apps, RBAC permissions, teams, payments,
 * emails, etc.). Returns `null` when there is no project context to read from.
 */
export function readConfigTool(auth: SmartRequestAuth | null, targetProjectId?: string | null) {
  const target = resolveConfigTarget(auth, targetProjectId);
  if (target == null) {
    return null;
  }

  return tool({
    description: "Read the current Hexclave branch config object for this project. This is the resolved configuration that is usually stored in the project's `hexclave.config.ts` file — it includes settings such as installed apps (`apps`), authentication and sign-up behavior (`auth`), API keys (`apiKeys`), RBAC permissions (`rbac`), teams (`teams`), users (`users`), onboarding, emails, and payments. Use this whenever you need to know how the project is currently configured.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const config = await rawQuery(globalPrismaClient, getRenderedBranchConfigQuery(target));
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
    },
  });
}
