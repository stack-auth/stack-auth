import { ensureTeamMembershipExists, ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      project: yupObject({
        id: yupString().oneOf(["internal"]).defined(),
      }).defined(),
      user: yupObject({
        id: yupString().defined(),
      }).defined(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      new_team_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupString().oneOf(["true"]).defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const { auth, body } = req;

    const internalTenancy = await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID);
    const internalPrisma = await getPrismaClientForTenancy(internalTenancy);

    // Get the project to transfer
    const projectToTransfer = await globalPrismaClient.project.findUnique({
      where: {
        id: body.project_id,
      },
    });

    if (!projectToTransfer) {
      throw new KnownErrors.ProjectNotFound(body.project_id);
    }

    if (!projectToTransfer.ownerTeamId) {
      throw new StatusError(400, "Project must have an owner team to be transferred");
    }

    // Check if user is a team admin of the current owner team
    await ensureUserTeamPermissionExists(internalPrisma, {
      tenancy: internalTenancy,
      teamId: projectToTransfer.ownerTeamId,
      userId: auth.user.id,
      permissionId: "team_admin",
      errorType: "required",
      recursive: true,
    });

    // Check if user is a member of the new team (doesn't need to be admin)
    await ensureTeamMembershipExists(internalPrisma, {
      tenancyId: internalTenancy.id,
      teamId: body.new_team_id,
      userId: auth.user.id,
    });

    // Transfer the project
    await globalPrismaClient.project.update({
      where: {
        id: body.project_id,
      },
      data: {
        ownerTeamId: body.new_team_id,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: "true",
      },
    };
  },
});
