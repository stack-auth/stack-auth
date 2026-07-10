import { clearBranchConfigPushedError, setBranchConfigPushedError } from "@/lib/config";
import { isDevelopmentEnvironmentProject } from "@/lib/development-environment";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

const pushedConfigErrorMessageSchema = yupString().max(1_000).defined();

async function assertRdeProject(projectId: string): Promise<void> {
  if (!(await isDevelopmentEnvironmentProject(projectId))) {
    throw new StatusError(StatusError.Forbidden, "Pushed config errors can only be set for development-environment projects.");
  }
}

export const PUT = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Set pushed config error",
    description: "Attach the latest pushed config error to the current development-environment branch config override.",
    tags: ["Config"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      error_message: pushedConfigErrorMessageSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req) => {
    await assertRdeProject(req.auth.tenancy.project.id);
    await setBranchConfigPushedError({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      error: {
        message: req.body.error_message,
      },
    });
    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: "Clear pushed config error",
    description: "Clear the latest pushed config error on the current development-environment branch config override.",
    tags: ["Config"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req) => {
    await assertRdeProject(req.auth.tenancy.project.id);
    await clearBranchConfigPushedError({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
    });
    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
