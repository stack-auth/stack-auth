// this exists as an alias for OIDC discovery, because the `iss` field in the JWT does not support query params
// redirect to projects/.well-known/[...route]?include_anonymous=true

import { yupNever, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { redirect } from "next/navigation";
import { createSmartRouteHandler } from "../../../../../../route-handlers/smart-route-handler";

const handler = createSmartRouteHandler({
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

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
