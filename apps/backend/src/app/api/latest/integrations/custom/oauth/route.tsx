import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    url: yupString().defined(),
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["text"]).defined(),
    body: yupString().defined(),
  }),
  handler: async (req) => {
    return {
      statusCode: 200,
      bodyType: "text",
      body: deindent`
        Authorization endpoint: ${new URL("authorize", req.url + "/").toString()}
        Token endpoint: ${new URL("token", req.url + "/").toString()}
      `,
    };
  },
});
