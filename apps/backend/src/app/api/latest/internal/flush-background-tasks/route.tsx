import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { drainInFlightPromises } from "@/utils/background-tasks";
import { adaptSchema, adminAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

// Test/dev-only hook that awaits any in-flight background tasks spawned via
// `runAsynchronouslyAndWaitUntil` (e.g. Stripe webhook processing, which is
// intentionally fire-and-forget in production for fast acks — see the stripe
// webhooks route). E2E tests hit the backend over HTTP and cannot await the
// in-process promise directly, so without this they race the background work
// and read side effects before they are written. On Vercel this is a no-op
// (the platform's native `waitUntil` is used instead of the tracked set), so
// this endpoint only has an effect on the non-serverless runtimes used in dev
// and CI.
export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async () => {
    await drainInFlightPromises();
    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});
