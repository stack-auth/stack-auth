import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createVerificationCodeHandler } from "@/route-handlers/verification-code-handler";
import { VerificationCodeType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";

export const integrationProjectTransferCodeHandler = createVerificationCodeHandler({
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
    client_id: yupString().defined(),
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
        clientId: data.client_id,
      },
    });
    if (provisionedProjects.length === 0) throw new StatusError(400, "The project to transfer was not provisioned or has already been transferred.");
  },

  async handler(tenancy, method, data, body, user) {
    const project = tenancy.project;
    if (!user) throw new KnownErrors.UserAuthenticationRequired;

    const provisionedProject = await globalPrismaClient.provisionedProject.deleteMany({
      where: {
        projectId: data.project_id,
        clientId: data.client_id,
      },
    });

    if (provisionedProject.count === 0) throw new StatusError(400, "The project to transfer was not provisioned or has already been transferred.");

    const prisma = await getPrismaClientForTenancy(tenancy);

    const recentDbUser = await prisma.projectUser.findUnique({
      where: {
        tenancyId_projectUserId: {
          tenancyId: tenancy.id,
          projectUserId: user.id,
        },
      },
    }) ?? throwErr("Authenticated user not found in transaction. Something went wrong. Did the user delete their account at the wrong time? (Very unlikely.)");
    const rduServerMetadata: any = recentDbUser.serverMetadata;

    await prisma.projectUser.update({
      where: {
        tenancyId_projectUserId: {
          tenancyId: tenancy.id,
          projectUserId: user.id,
        },
      },
      data: {
        serverMetadata: {
          ...typeof rduServerMetadata === "object" ? rduServerMetadata : {},
          managedProjectIds: [
            ...(Array.isArray(rduServerMetadata?.managedProjectIds) ? rduServerMetadata.managedProjectIds : []),
            data.project_id,
          ],
        },
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
