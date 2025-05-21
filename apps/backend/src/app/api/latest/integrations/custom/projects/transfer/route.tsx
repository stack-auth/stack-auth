import { getProject } from "@/lib/projects";
import { DEFAULT_BRANCH_ID, getSoleTenancyFromProjectBranch } from "@/lib/tenancies";
import { prismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { neonAuthorizationHeaderSchema, urlSchema, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { decodeBasicAuthorizationHeader } from "@stackframe/stack-shared/dist/utils/http";
import { integrationProjectTransferCodeHandler } from "./confirm/verification-code-handler";

async function validateAndGetTransferInfo(authorizationHeader: string, projectId: string) {
  const [clientId, clientSecret] = decodeBasicAuthorizationHeader(authorizationHeader)!;
  const internalProject = await getProject("internal") ?? throwErr("Internal project not found");

  const provisionedProject = await prismaClient.provisionedProject.findUnique({
    where: {
      projectId,
      externalProjectId: clientId,
    },
  });
  if (!provisionedProject) {
    // note: Neon relies on this exact status code and error message, so don't change it without consulting them first
    throw new StatusError(400, "This project either doesn't exist or the current external project is not authorized to transfer it. Note that projects can only be transferred once.");
  }

  return {
    provisionedProject,
    internalProject,
  };
}


export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    query: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    headers: yupObject({
      authorization: yupTuple([neonAuthorizationHeaderSchema.defined()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      message: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    await validateAndGetTransferInfo(req.headers.authorization[0], req.query.project_id);

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        message: "Ready to transfer project; please use the POST method to initiate it.",
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    headers: yupObject({
      authorization: yupTuple([neonAuthorizationHeaderSchema.defined()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      confirmation_url: urlSchema.defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const { provisionedProject } = await validateAndGetTransferInfo(req.headers.authorization[0], req.body.project_id);

    const transferCodeObj = await integrationProjectTransferCodeHandler.createCode({
      tenancy: await getSoleTenancyFromProjectBranch("internal", DEFAULT_BRANCH_ID),
      method: {},
      data: {
        project_id: provisionedProject.projectId,
        external_project_id: provisionedProject.externalProjectId,
      },
      callbackUrl: new URL("/integrations/custom/projects/transfer/confirm", getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL")),
      expiresInMs: 1000 * 60 * 60,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        confirmation_url: transferCodeObj.link.toString(),
      },
    };
  },
});
