import { POST as latestHandler } from "@/app/api/latest/payments/purchases/validate-code/route";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ensureObjectSchema, yupArray, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

const latestInit = latestHandler.initArgs[0];
const responseSchema = ensureObjectSchema(latestInit.response);
const responseBodySchema = ensureObjectSchema(responseSchema.getNested("body"));


export const POST = createSmartRouteHandler({
  ...latestInit,
  response: responseSchema.concat(yupObject({
    body: responseBodySchema.concat(yupObject({
      offer: responseBodySchema.getNested("product").meta({ openapiField: { hidden: true } }),
      conflicting_group_offers: yupArray(yupObject({
        offer_id: yupString().defined(),
        display_name: yupString().defined(),
      }).defined()).defined().meta({ openapiField: { hidden: true } }),
    })),
  })),
  handler: async (_req, fullReq) => {
    const response = await latestHandler.invoke(fullReq);
    return {
      ...response,
      body: {
        ...response.body,
        offer: response.body.product,
        conflicting_group_offers: response.body.conflicting_products.map(({ product_id, display_name }) => ({
          offer_id: product_id,
          display_name,
        })),
      }
    };
  },
});
