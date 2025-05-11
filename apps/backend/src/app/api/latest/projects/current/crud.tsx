import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { clientProjectsCrud } from "@stackframe/stack-shared/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/utils/proxies";

export const clientProjectsCrudHandlers = createLazyProxy(() => createCrudHandlers(clientProjectsCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    return {
      ...auth.project,
      config: auth.tenancy.config,
    };
  },
}));
