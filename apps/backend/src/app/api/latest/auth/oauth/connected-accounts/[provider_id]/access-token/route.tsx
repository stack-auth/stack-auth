import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

// TODO: Deprecated route, remove together with the v1 dashboard endpoints
export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      scope: yupString().optional(),
    }).defined(),
    params: yupObject({
      provider_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ params, body }, fullReq) => {
    const response = await fetch(
      `${getEnvVariable('NEXT_PUBLIC_STACK_API_URL')}/api/v1/connected-accounts/me/${params.provider_id}/access-token`,
      {
        method: 'POST',
        headers: Object.fromEntries(Object.entries(fullReq.headers).map(([key, value]) => [key, value?.[0] || ""])),
        body: JSON.stringify(body)
      }
    );

    return {
      statusCode: response.status,
      bodyType: "json",
      body: await response.json()
    };
  }
});
