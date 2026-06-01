import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { neonAuthorizationHeaderSchema, yupArray, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { decodeBasicAuthorizationHeader } from "@hexclave/shared/dist/utils/http";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    query: yupObject({
      project_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      connection_strings: yupArray(yupObject({
        branch_id: yupString().defined(),
        connection_string: yupString().defined(),
      }).defined()).defined(),
    }).defined(),
    headers: yupObject({
      authorization: yupTuple([neonAuthorizationHeaderSchema.defined()]).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      project_id: yupString().defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const [clientId] = decodeBasicAuthorizationHeader(req.headers.authorization[0])!;
    const provisionedProject = await globalPrismaClient.provisionedProject.findUnique({
      where: {
        projectId: req.query.project_id,
        clientId: clientId,
      },
    });
    if (!provisionedProject) {
      throw new KnownErrors.ProjectNotFound(req.query.project_id);
    }

    // Connection strings used to configure Neon as source-of-truth. That mode no
    // longer exists, but keep accepting this webhook so old integrations do not fail.

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        project_id: provisionedProject.projectId,
      },
    };
  },
});
