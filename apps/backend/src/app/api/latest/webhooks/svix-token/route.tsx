import { getSvixClient } from "@/lib/webhooks";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { svixTokenCrud } from "@stackframe/stack-shared/dist/interface/crud/svix-token";
import { yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

const svixServerUrl = getEnvVariable("STACK_SVIX_SERVER_URL", "");

const appPortalCrudHandlers = createLazyProxy(() => createCrudHandlers(svixTokenCrud, {
  paramsSchema: yupObject({}),
  onCreate: async ({ auth }) => {
    const svix = getSvixClient();
    await svix.application.getOrCreate({ uid: auth.project.id, name: auth.project.id });
    const result = await svix.authentication.appPortalAccess(auth.project.id, {});
    // svix embedded app portal is only available on hosted svix.
    const url = svixServerUrl ? undefined : result.url;
    return { token: result.token, url };
  },
}));

export const POST = appPortalCrudHandlers.createHandler;
