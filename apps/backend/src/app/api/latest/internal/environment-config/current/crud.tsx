import { overrideEnvironmentConfigOverride } from "@/lib/config";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { environmentConfigCrud } from "@stackframe/stack-shared/dist/interface/crud/environment-config";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const environmentConfigCrudHandlers = createLazyProxy(() => createCrudHandlers(environmentConfigCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    return {
      id: auth.tenancy.id,
      project_id: auth.project.id,
      branch_id: auth.tenancy.branchId,
      organization_id: auth.tenancy.organization?.id,
      config: auth.tenancy.config,
    };
  },
  onUpdate: async ({ auth, data }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);

    if (data.config) {
      await overrideEnvironmentConfigOverride({
        tx: prisma,
        projectId: auth.project.id,
        branchId: auth.tenancy.branchId,
        environmentConfigOverrideOverride: data.config,
      });
    }

    return {
      id: auth.tenancy.id,
      project_id: auth.project.id,
      branch_id: auth.tenancy.branchId,
      organization_id: auth.tenancy.organization?.id,
      config: auth.tenancy.config,
    };
  },
}));
