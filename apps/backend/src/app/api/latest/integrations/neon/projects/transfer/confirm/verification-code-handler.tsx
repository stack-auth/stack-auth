import { teamsCrudHandlers } from "@/app/api/latest/teams/crud";
import { globalPrismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const neonIntegrationProjectTransferCodeHandler = createVerificationCodeHandler({
  metadata: {
    post: {
      hidden: true,
    },
    check: {
      hidden: true,
    },
  },
  type: VerificationCodeType.INTEGRATION_PROJECT_TRANSFER,
  data: yupObject({
    neon_client_id: yupString().defined(),
    project_id: yupString().defined(),
  }).defined(),
  method: yupObject({}),
  requestBody: yupObject({}),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
    }).defined(),
  }),
  async validate(tenancy, method, data) {
    const project = tenancy.project;
    if (project.id !== "internal") throw new StatusError(400, "This endpoint is only available for internal projects.");
    const provisionedProjects = await globalPrismaClient.provisionedProject.findMany({
      where: {
        projectId: data.project_id,
        clientId: data.neon_client_id,
      },
    });
    if (provisionedProjects.length === 0) throw new StatusError(400, "The project to transfer was not provisioned by Neon or has already been transferred.");
  },

  async handler(tenancy, method, data, body, user) {
    if (tenancy.project.id !== "internal") throw new StackAssertionError("This endpoint is only available for internal projects, why is it being called for a non-internal project?");
    if (!user) throw new KnownErrors.UserAuthenticationRequired;

    const provisionedProject = await globalPrismaClient.provisionedProject.deleteMany({
      where: {
        projectId: data.project_id,
        clientId: data.neon_client_id,
      },
    });

    if (provisionedProject.count === 0) throw new StatusError(400, "The project to transfer was not provisioned by Neon or has already been transferred.");

    const project = await globalPrismaClient.project.findUnique({
      where: {
        id: data.project_id,
      },
    });
    if (!project) throw new StatusError(400, "The project to transfer was not found.");
    if (project.ownerTeamId) throw new StatusError(400, "The project to transfer has already been transferred.");

    const team = await teamsCrudHandlers.adminCreate({
      data: {
        display_name: user.display_name ?
          `${user.display_name}'s Team` :
          user.primary_email ?
            `${user.primary_email}'s Team` :
            "Personal Team",
        creator_user_id: 'me',
      },
      tenancy,
      user,
    });

    await globalPrismaClient.project.update({
      where: {
        id: data.project_id,
      },
      data: {
        ownerTeamId: team.id,
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: data.project_id,
      },
    };
  }
});
