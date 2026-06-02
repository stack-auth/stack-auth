import { createAnalyticsClickmapToken } from "@/lib/analytics-clickmap-tokens";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { AnalyticsClickmapTokenResponseBodySchema } from "@hexclave/shared/dist/interface/admin-metrics";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      origin: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: AnalyticsClickmapTokenResponseBodySchema,
  }),
  handler: async ({ auth, body }) => {
    const token = await createAnalyticsClickmapToken({ tenancy: auth.tenancy, origin: body.origin });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        token: token.token,
        origin: token.origin,
        expires_at_millis: token.expiresAtMillis,
      },
    };
  },
});
