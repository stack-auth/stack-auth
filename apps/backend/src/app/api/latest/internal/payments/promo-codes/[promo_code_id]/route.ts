import { getPromoCode, softDeletePromoCode, updatePromoCode } from "@/lib/payments/promo-codes";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { promoCodeReadSchema, promoCodeUpdateSchema } from "@hexclave/shared/dist/interface/crud/promo-codes";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

const authSchema = yupObject({
  type: adminAuthTypeSchema.defined(),
  project: adaptSchema.defined(),
  tenancy: adaptSchema.defined(),
}).defined();

const paramsSchema = yupObject({
  promo_code_id: yupString().defined(),
}).defined();

export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: promoCodeReadSchema,
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const promoCode = await getPromoCode({
      prisma,
      tenancyId: auth.tenancy.id,
      promoCodeId: params.promo_code_id,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: promoCode,
    };
  },
});

export const PATCH = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
    body: promoCodeUpdateSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: promoCodeReadSchema,
  }),
  handler: async ({ auth, params, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const promoCode = await updatePromoCode({
      prisma,
      tenancyId: auth.tenancy.id,
      promoCodeId: params.promo_code_id,
      data: body,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: promoCode,
    };
  },
});

export const DELETE = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: authSchema,
    params: paramsSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ auth, params }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await softDeletePromoCode({
      prisma,
      tenancyId: auth.tenancy.id,
      promoCodeId: params.promo_code_id,
    });
    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
