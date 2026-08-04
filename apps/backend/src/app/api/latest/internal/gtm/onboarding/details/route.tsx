import { completeGtmOnboarding, getGtmOnboarding } from "@/lib/gtm/dashboard-content";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupMixed, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({
  type: adminAuthTypeSchema.defined(),
  project: adaptSchema.defined(),
}).defined();
const responseSchema = yupObject({
  statusCode: yupNumber().defined(),
  bodyType: yupString().oneOf(["json"]).defined(),
  body: yupMixed().defined(),
});

export const GET = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    method: yupString().oneOf(["GET"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth }) => {
    return { statusCode: 200, bodyType: "json", body: await getGtmOnboarding(auth.project.id) };
  },
});

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    auth: authSchema,
    body: yupObject({
      domain: yupString().trim().max(253).optional(),
      phone: yupString().trim().matches(/^[+0-9(). -]+$/, "phone must contain only phone-number characters").min(7).max(50).defined(),
      notes: yupString().trim().max(2000).optional(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: responseSchema,
  handler: async ({ auth, body }) => {
    return { statusCode: 200, bodyType: "json", body: await completeGtmOnboarding(auth.project.id, body) };
  },
});
