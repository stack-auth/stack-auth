import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupNumber, yupObject } from "@stackframe/stack-shared/dist/schema-fields";

// $ stripe listen --forward-to http://localhost:8102/api/v1/webhooks/stripe
// $ stripe trigger payment_intent.succeeded
export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupMixed().defined(),
    headers: yupObject({}).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
  }),
  handler: async ({ body }) => {
    console.log("Event data:", body);
    return {
      statusCode: 200,
    };
  },
});
