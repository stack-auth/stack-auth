import { resetBranchConfigOverrideKeys, resetEnvironmentConfigOverrideKeys } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupArray, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const levelSchema = yupString().oneOf(["branch", "environment"]).defined();

const levelConfigs = {
  branch: {
    reset: (options: { projectId: string, branchId: string, keysToReset: string[] }) =>
      resetBranchConfigOverrideKeys(options),
  },
  environment: {
    reset: (options: { projectId: string, branchId: string, keysToReset: string[] }) =>
      resetEnvironmentConfigOverrideKeys(options),
  },
};

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
    summary: 'Reset config override keys',
    description: 'Remove specific keys (and their nested descendants) from the config override at a given level. Uses the same nested key logic as the override algorithm.',
    tags: ['Config'],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    params: yupObject({
      level: levelSchema,
    }).defined(),
    body: yupObject({
      keys: yupArray(yupString().defined()).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req) => {
    const levelConfig = levelConfigs[req.params.level];

    await levelConfig.reset({
      projectId: req.auth.tenancy.project.id,
      branchId: req.auth.tenancy.branchId,
      keysToReset: req.body.keys,
    });

    return {
      statusCode: 200 as const,
      bodyType: "success" as const,
    };
  },
});
