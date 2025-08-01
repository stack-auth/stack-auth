import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { configCrud } from "@stackframe/stack-shared/dist/interface/crud/config";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const configCrudHandlers = createLazyProxy(() => createCrudHandlers(configCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    return {
      config_string: JSON.stringify(auth.tenancy.config),
    };
  },
}));
