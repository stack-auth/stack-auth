import { getBranchConfigPushedError, getDevelopmentEnvironmentConfigWarnings, renderedOrganizationConfigToProjectCrud } from "@/lib/config";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { clientProjectsCrud } from "@hexclave/shared/dist/interface/crud/projects";
import { yupObject } from "@hexclave/shared/dist/schema-fields";
import { createLazyProxy } from "@hexclave/shared/dist/utils/proxies";

export const clientProjectsCrudHandlers = createLazyProxy(() => createCrudHandlers(clientProjectsCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    return {
      ...auth.project,
      pushed_config_error: await getBranchConfigPushedError({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
      }),
      config_warnings: await getDevelopmentEnvironmentConfigWarnings({
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
        organizationId: auth.tenancy.organization?.id ?? null,
      }),
      config: renderedOrganizationConfigToProjectCrud(auth.tenancy.config),
    };
  },
}));
