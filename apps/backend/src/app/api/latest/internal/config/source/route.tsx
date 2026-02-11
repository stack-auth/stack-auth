import { getBranchConfigOverrideSource, unlinkBranchConfigOverrideSource } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, branchConfigSourceSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: 'Get pushed config source',
    description: 'Get the source metadata for the pushed config (where it was pushed from)',
    tags: ['Config'],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      source: branchConfigSourceSchema.defined(),
    }).defined(),
  }),
  handler: async (req) => {
    const source = await getBranchConfigOverrideSource({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        source,
      },
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: 'Unlink pushed config source',
    description: 'Set the pushed config source to unlinked, allowing direct dashboard editing',
    tags: ['Config'],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req) => {
    await unlinkBranchConfigOverrideSource({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});

