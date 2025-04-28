import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { clientProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const clientProjectsCrudHandlers = createLazyProxy(() => createCrudHandlers(clientProjectsCrud, {
  paramsSchema: yupObject({}),
  onRead: async ({ auth }) => {
    if (!("config" in auth.project)) {
      throw new StackAssertionError("Project config is not available, even though it should be");
    }
    return auth.project as any;
  },
}));
