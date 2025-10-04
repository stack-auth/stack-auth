import { getRenderedEnvironmentConfigQuery, overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { environmentConfigSchema, getConfigOverrideErrors, migrateConfigOverride } from "@stackframe/stack-shared/dist/config/schema";
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

      // TODO instead of doing this check here, we should change overrideEnvironmentConfigOverride to return the errors from its ensureNoConfigOverrideErrors call
      const overrideError = await getConfigOverrideErrors(environmentConfigSchema, migrateConfigOverride("environment", parsedConfig));
      if (overrideError.status === "error") {
        throw new StatusError(StatusError.BadRequest, overrideError.error);
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
