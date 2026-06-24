import { createPromoCode, listPromoCodes } from "@/lib/payments/promo-codes";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { promoCodeCreateResponseSchema, promoCodeCreateSchema, promoCodeListResponseSchema } from "@hexclave/shared/dist/interface/crud/promo-codes";
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
    query: yupObject({
      include_deleted: yupString().oneOf(["true", "false"]).optional(),
      limit: yupString().optional(),
    }).optional(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: promoCodeListResponseSchema,
  }),
  handler: async ({ auth, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const parsedLimit = Number.parseInt(query.limit ?? "100", 10);
    const items = await listPromoCodes({
      prisma,
      tenancyId: auth.tenancy.id,
      includeDeleted: query.include_deleted === "true",
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

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: promoCodeCreateSchema,
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: promoCodeCreateResponseSchema,
  }),
  handler: async ({ auth, body }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const created = await createPromoCode({
      prisma,
      tenancyId: auth.tenancy.id,
      data: body,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: created,
    };
  },
});
