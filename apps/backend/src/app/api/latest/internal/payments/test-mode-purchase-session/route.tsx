import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { ensureCustomerExists } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedEntries } from "@stackframe/stack-shared/dist/utils/objects";

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
    body: yupObject({
      full_code: yupString().defined(),
      price_id: yupString().defined(),
      quantity: yupNumber().integer().min(1).default(1),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ auth, body }) => {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);
    if (auth.tenancy.id !== data.tenancyId) {
      throw new StatusError(400, "Tenancy id does not match value from code data");
    }
    if (data.offer.prices === "include-by-default") {
      throw new StatusError(400, "This offer does not have any prices");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const pricesMap = new Map(Object.entries(data.offer.prices));
    const selectedPrice = pricesMap.get(price_id);
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found on offer associated with this purchase code");
    }
    if (quantity !== 1 && data.offer.stackable !== true) {
      throw new StatusError(400, "This offer is not stackable; quantity must be 1");
    }
    // In test mode, simulate the purchase by creating ItemQuantityChange entries for included items
    await ensureCustomerExists({
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: data.offer.customerType,
      customerId: data.customerId,
    });

    const includedItems = getOrUndefined(data.offer, "includedItems") || {};
    const multipliedQuantity = Math.max(1, quantity);
    for (const [itemId, inc] of typedEntries(includedItems)) {
      const grant = (inc.quantity || 0) * multipliedQuantity;
      if (!grant) continue;
      await prisma.itemQuantityChange.create({
        data: {
          tenancyId: auth.tenancy.id,
          customerId: data.customerId,
          itemId,
          quantity: grant,
          description: `TEST_MODE_PURCHASE offerId=${data.offerId ?? "inline"}`,
        },
      });
    }
    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy: auth.tenancy,
      id: codeId,
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
