import { POST as latestHandler } from "@/app/api/latest/payments/purchases/create-purchase-url/route";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ensureObjectSchema, inlineProductSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { normalizePurchaseBody } from "../offers-compat";

const latestInit = latestHandler.initArgs[0];

const requestSchema = ensureObjectSchema(latestInit.request);
const requestBodySchema = ensureObjectSchema(requestSchema.getNested("body"));

export const POST = createSmartRouteHandler({
  ...latestInit,
  request: requestSchema.concat(yupObject({
    body: requestBodySchema.concat(yupObject({
      offer_id: yupString().optional(),
      offer_inline: inlineProductSchema.optional(),
    })),
  })),
  handler: async (_req, fullReq) => {
    const body = normalizePurchaseBody(fullReq.body as Record<string, any>);
    const translatedRequest = {
      ...fullReq,
      body,
    };

    return await latestHandler.invoke(translatedRequest);
  },
});
