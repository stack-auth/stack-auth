import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNever, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { redirect } from "next/navigation";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    url: yupString().defined(),
    query: yupObject({
      client_id: yupString().defined(),
      redirect_uri: yupString().defined(),
      state: yupString().defined(),
      code_challenge: yupString().defined(),
      code_challenge_method: yupString().oneOf(["S256"]).defined(),
      response_type: yupString().oneOf(["code"]).defined(),
    }).defined(),
  }),
  response: yupNever(),
  handler: async (req) => {
    const url = new URL(req.url);
    if (url.pathname !== "/api/v1/integrations/custom/oauth/authorize") {
      throw new StackAssertionError(`Expected pathname to be authorize endpoint but got ${JSON.stringify(url.pathname)}`, { url });
    }
    url.pathname = "/api/v1/integrations/custom/oauth/idp/auth";
    url.search = new URLSearchParams({ ...req.query, scope: "openid" }).toString();
    redirect(url.toString());
  },
});
