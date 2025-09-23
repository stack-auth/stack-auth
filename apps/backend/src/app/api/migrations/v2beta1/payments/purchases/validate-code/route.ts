import { POST as latestHandler } from "@/app/api/latest/payments/purchases/validate-code/route";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { ensureObjectSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { addOfferAliasesToValidateCodeBody } from "../offers-compat";

const latestInit = latestHandler.initArgs[0];
const responseSchema = ensureObjectSchema(latestInit.response);
const responseBodySchema = ensureObjectSchema(responseSchema.getNested("body"));
const productSchema = responseBodySchema.getNested("product");
const conflictingGroupProductsSchema = responseBodySchema.getNested("conflicting_group_products") as any;
const conflictingGroupProductItemSchema = ensureObjectSchema(conflictingGroupProductsSchema.innerType as any);

const conflictingGroupOffersSchema = conflictingGroupProductsSchema.clone().of(
  conflictingGroupProductItemSchema.clone().concat(yupObject({
    offer_id: conflictingGroupProductItemSchema.getNested("product_id"),
  })),
);

export const POST = createSmartRouteHandler({
  ...latestInit,
  response: responseSchema.concat(yupObject({
    body: responseBodySchema.concat(yupObject({
      offer: productSchema,
      conflicting_group_offers: conflictingGroupOffersSchema,
    })),
  })),
  handler: async (_req, fullReq) => {
    const response = await latestHandler.invoke(fullReq);
    return {
      ...response,
      body: addOfferAliasesToValidateCodeBody(response.body as any),
    };
  },
});
