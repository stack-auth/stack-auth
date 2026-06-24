import { listPromoCodeRedemptions } from "@/lib/payments/promo-codes";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { promoCodeRedemptionListResponseSchema } from "@hexclave/shared/dist/interface/crud/promo-codes";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      promo_code_id: yupString().defined(),
    }).defined(),
    query: yupObject({
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: promoCodeRedemptionListResponseSchema,
  }),
  handler: async ({ auth, params, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const parsedLimit = Number.parseInt(query.limit ?? "100", 10);
    const items = await listPromoCodeRedemptions({
      prisma,
      tenancyId: auth.tenancy.id,
      promoCodeId: params.promo_code_id,
      limit: Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 100)),
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items,
        next_cursor: null,
      },
    };
  },
});
