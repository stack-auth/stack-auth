import { getRenderedEnvironmentConfigQuery, overrideEnvironmentConfigOverride } from "@/lib/config";
import { globalPrismaClient, rawQuery } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { configOverridesCrud } from "@stackframe/stack-shared/dist/interface/crud/config-overrides";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const configOverridesCrudHandlers = createLazyProxy(() => createCrudHandlers(configOverridesCrud, {
  paramsSchema: yupObject({
    emailId: yupString().optional(),
  }),
  onRead: async ({ auth }) => {
    return {
      id: auth.project.id,
      branch_id: auth.tenancy.branchId,
      organization_id: auth.tenancy.organization?.id,
      project_id: auth.project.id,
      config: JSON.stringify(auth.tenancy.config),
    };
  },
  onUpdate: async ({ auth, data }) => {
    if (auth.tenancy.organization) {
      throw new StatusError(StatusError.BadRequest, 'Organizational config overrides are not yet supported');
    }

    if (data.config) {
      let parsedConfig;
      try {
        parsedConfig = JSON.parse(data.config);
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
        tx: globalPrismaClient,
      });
    }

    const updatedConfig = await rawQuery(globalPrismaClient, getRenderedEnvironmentConfigQuery({
      projectId: auth.tenancy.project.id,
      branchId: auth.tenancy.branchId,
    }));

    return {
      id: auth.project.id,
      branch_id: auth.tenancy.branchId,
      // @ts-expect-error: remove this once we support organizational config overrides
      organization_id: auth.tenancy.organization?.id,
      project_id: auth.project.id,
      config: JSON.stringify(updatedConfig),
    };
  },
}));
