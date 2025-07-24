import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { tenancyCrud } from "@stackframe/stack-shared/dist/interface/crud/tenancy";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const tenancyCrudHandlers = createLazyProxy(() => createCrudHandlers(tenancyCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    return {
      id: auth.tenancy.id,
      project_id: auth.project.id,
      branch_id: auth.tenancy.branchId,
      organization_id: auth.tenancy.organization?.id,
      config: auth.tenancy.completeConfig,
    };
  },
  onUpdate: async ({ auth, data }) => {
    return {
      id: auth.tenancy.id,
      project_id: auth.project.id,
      branch_id: auth.tenancy.branchId,
      organization_id: auth.tenancy.organization?.id,
      config: auth.tenancy.completeConfig,
    };
  },
}));
