import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { environmentConfigSchema, getConfigOverrideErrors, migrateConfigOverride } from "@stackframe/stack-shared/dist/config/schema";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const PATCH = createSmartRouteHandler({
  metadata: {
    summary: 'Update the config',
    description: 'Update the config for a project and branch with an override',
    tags: ['Config'],
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema,
    }).defined(),
    body: yupObject({
      config_override_string: yupString().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async (req) => {
    if (req.body.config_override_string) {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(req.body.config_override_string);
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new StatusError(StatusError.BadRequest, 'Invalid config JSON');
        }
        throw e;
      }

      // TODO instead of doing this check here, we should change overrideEnvironmentConfigOverride to return the errors from its ensureNoConfigOverrideErrors call
      const overrideError = await getConfigOverrideErrors(environmentConfigSchema, migrateConfigOverride("environment", parsedConfig));
      if (overrideError.status === "error") {
        throw new StatusError(StatusError.BadRequest, overrideError.error);
      }

      await overrideEnvironmentConfigOverride({
        projectId: req.auth.tenancy.project.id,
        branchId: req.auth.tenancy.branchId,
        environmentConfigOverrideOverride: parsedConfig,
      });
    }

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
