import { getSvixClient } from "@/lib/webhooks";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { svixTokenCrud } from "@stackframe/stack-shared/interface/crud/svix-token";
import { yupObject } from "@stackframe/stack-shared/schema-fields";
import { createLazyProxy } from "@stackframe/stack-shared/utils/proxies";

const appPortalCrudHandlers = createLazyProxy(() => createCrudHandlers(svixTokenCrud, {
  paramsSchema: yupObject({}),
  onCreate: async ({ auth }) => {
    const svix = getSvixClient();
    await svix.application.getOrCreate({ uid: auth.project.id, name: auth.project.id });
    const result = await svix.authentication.appPortalAccess(auth.project.id, {});
    return { token: result.token };
  },
}));

export const POST = appPortalCrudHandlers.createHandler;
