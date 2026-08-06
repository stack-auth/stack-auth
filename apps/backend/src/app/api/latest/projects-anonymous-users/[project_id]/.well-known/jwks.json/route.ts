// Anonymous JWTs use a distinct issuer URL without query parameters. This alias gives
// consumers an issuer-relative JWKS URL while reusing the canonical project endpoint.

import { yupNever, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { redirect } from "@/lib/runtime/navigation";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    url: yupString().defined(),
  }),
  response: yupNever(),
  handler: async (req) => {
    const url = new URL(req.url);
    url.pathname = url.pathname.replace("projects-anonymous-users", "projects");
    url.searchParams.set("include_anonymous", "true");
    redirect(url.toString());
  },
});
