import { getRenderedEnvironmentConfigQuery, overrideEnvironmentConfigOverride, validateEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { configOverrideCrud } from "@stackframe/stack-shared/dist/interface/crud/config";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const configOverridesCrudHandlers = createLazyProxy(() => createCrudHandlers(configOverrideCrud, {
  paramsSchema: yupObject({}),
  onUpdate: async ({ auth, data }) => {
    if (data.config_override_string) {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(data.config_override_string);
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new StatusError(StatusError.BadRequest, 'Invalid config JSON');
        }
        throw e;
      }

      const validationResult = await validateEnvironmentConfigOverride({
        environmentConfigOverride: parsedConfig,
        branchId: auth.tenancy.branchId,
        projectId: auth.tenancy.project.id,
      });

      if (validationResult.status === "error") {
        throw new StatusError(StatusError.BadRequest, validationResult.error);
      }

      await overrideEnvironmentConfigOverride({
        projectId: auth.tenancy.project.id,
        branchId: auth.tenancy.branchId,
        environmentConfigOverrideOverride: parsedConfig,
      });
    }

    const updatedConfig = await rawQuery(globalPrismaClient, getRenderedEnvironmentConfigQuery({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
    }));

    return {
      config_override_string: JSON.stringify(updatedConfig),
    };
  },
}));
