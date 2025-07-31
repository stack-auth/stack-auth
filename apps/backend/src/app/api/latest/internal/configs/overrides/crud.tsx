import { getRenderedEnvironmentConfigQuery, overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { configOverrideCrud } from "@stackframe/stack-shared/dist/interface/crud/config";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const configOverridesCrudHandlers = createLazyProxy(() => createCrudHandlers(configOverrideCrud, {
  paramsSchema: yupObject({
    emailId: yupString().optional(),
  }),
  onUpdate: async ({ auth, data }) => {
    if (data.configOverrideString) {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(data.configOverrideString);
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new StatusError(StatusError.BadRequest, 'Invalid config JSON');
        }
        throw e;
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
      configOverrideString: JSON.stringify(updatedConfig),
    };
  },
}));
