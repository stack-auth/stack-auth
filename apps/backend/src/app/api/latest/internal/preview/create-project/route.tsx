import { getClickhouseAdminClient } from "@/lib/clickhouse";
import { isPreviewModeEnabled } from "@/lib/preview-mode";
import { seedDummyProject } from "@/lib/seed-dummy-data";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { ignoreUnhandledRejection } from "@hexclave/shared/dist/utils/promises";

/**
 * Atomically claims one pre-seeded preview project from the pool by flipping
 * its `isAvailableAsPreviewProject` flag to false and assigning the given owner
 * team. Returns the project ID if one was available, or null otherwise.
 */
async function claimPoolProject(ownerTeamId: string): Promise<string | null> {
  const rows = await globalPrismaClient.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "Project"
    SET "isAvailableAsPreviewProject" = false,
        "ownerTeamId" = ${ownerTeamId}::uuid,
        "updatedAt" = NOW()
    WHERE "id" = (
      SELECT "id" FROM "Project"
      WHERE "isAvailableAsPreviewProject" = true
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"
  `);
  return rows[0]?.id ?? null;
}

/**
 * Asynchronously seeds a new preview project into the pool (with
 * isAvailableAsPreviewProject = true) so a future request can claim it
 * instantly.
 *
 * Pool projects have ownerTeamId = null so they don't appear in any user's
 * dashboard. The claim query assigns the real ownerTeamId when a project is
 * claimed.
 */
function replenishPreviewProjectPool(ownerTeamId: string): void {
  runAsynchronouslyAndWaitUntil(async () => {
    const clickhouseClient = getClickhouseAdminClient();
    const projectId = await seedDummyProject({
      ownerTeamId,
      oauthProviderIds: ['github', 'google', 'microsoft', 'spotify'],
      excludeAlphaApps: true,
      skipGithubConfigSource: true,
      clickhouseClient,
    });
    // Mark as available and null out ownerTeamId so the pool project doesn't
    // appear in the seeding user's dashboard. The claim query sets the real
    // ownerTeamId when the project is claimed.
    await globalPrismaClient.project.update({
      where: { id: projectId },
      data: {
        isAvailableAsPreviewProject: true,
        ownerTeamId: null,
      },
    });
  });
}

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Create a preview project",
    description: "Creates a new project pre-filled with dummy data for the preview environment. Only available when NEXT_PUBLIC_STACK_IS_PREVIEW=true.",
    tags: ["Internal"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
      user: adaptSchema.defined(),
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
    }).defined(),
    body: yupObject({}).optional().default({}),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth }) {
    if (!isPreviewModeEnabled()) {
      throw new StatusError(StatusError.Forbidden, "This endpoint is only available in preview mode");
    }

    const userId = auth.user.id;
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    // Find the user's first team (auto-created on sign-up via create_team_on_sign_up)
    const membership = await prisma.teamMember.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: userId,
      },
      select: {
        teamId: true,
      },
    });

    if (!membership) {
      throw new StatusError(StatusError.BadRequest, "User must belong to a team to create a preview project");
    }

    // Try to claim a pre-seeded project from the pool (near-instant).
    const claimedProjectId = await claimPoolProject(membership.teamId);

    let projectId: string;
    if (claimedProjectId) {
      projectId = claimedProjectId;
    } else {
      // Pool empty — fall back to creating a fresh project synchronously.
      const clickhouseClient = getClickhouseAdminClient();
      const clickhouseWarmup = clickhouseClient.command({ query: "SELECT 1" });
      ignoreUnhandledRejection(clickhouseWarmup);

      projectId = await seedDummyProject({
        ownerTeamId: membership.teamId,
        oauthProviderIds: ['github', 'google', 'microsoft', 'spotify'],
        excludeAlphaApps: true,
        skipGithubConfigSource: true,
        clickhouseClient,
      });

      await clickhouseWarmup;
    }

    // Replenish the pool asynchronously so the next request can be served
    // instantly. ownerTeamId is needed for seedDummyProject but gets nulled out
    // afterward — the claim query assigns the real owner.
    replenishPreviewProjectPool(membership.teamId);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: projectId,
      },
    };
  },
});
