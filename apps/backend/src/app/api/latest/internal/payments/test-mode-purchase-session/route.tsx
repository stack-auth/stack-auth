import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { grantProductToCustomer, validatePurchaseSession } from "@/lib/payments";
import { markPromoCodeRedemptionApplied, reservePromoCodeRedemption } from "@/lib/payments/promo-codes";
import { upsertProductVersion } from "@/lib/product-versions";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@hexclave/shared";
import { yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined(),
      price_id: yupString().defined(),
      quantity: yupNumber().integer().min(1).default(1),
      promo_code: yupString().optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ body }) => {
    const { full_code, price_id, quantity, promo_code } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);

    const tenancy = await getTenancy(data.tenancyId);
    if (!tenancy) {
      throw new HexclaveAssertionError("Tenancy not found for test mode purchase session");
    }
    if (tenancy.config.payments.blockNewPurchases) {
      throw new KnownErrors.NewPurchasesBlocked();
    }
    if (tenancy.config.payments.testMode !== true) {
      throw new StatusError(403, "Test mode is not enabled for this project");
    }
    const prisma = await getPrismaClientForTenancy(tenancy);
    const { selectedPrice } = await validatePurchaseSession({
      prisma,
      tenancyId: tenancy.id,
      customerType: data.product.customerType,
      customerId: data.customerId,
      product: data.product,
      productId: data.productId,
      priceId: price_id,
      quantity,
    });
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found on product associated with this purchase code");
    }
    const productVersionId = await upsertProductVersion({
      prisma,
      tenancyId: tenancy.id,
      productId: data.productId ?? null,
      productJson: data.product,
    });
    const promoRedemption = promo_code ? await reservePromoCodeRedemption({
      prisma,
      tenancyId: tenancy.id,
      customerType: data.product.customerType,
      customerId: data.customerId,
      product: data.product,
      productId: data.productId,
      priceId: price_id,
      selectedPrice,
      quantity,
      productVersionId,
      promoCode: promo_code,
    }) : null;

    const grantResult = await grantProductToCustomer({
      prisma,
      tenancy,
      customerType: data.product.customerType,
      customerId: data.customerId,
      product: data.product,
      productId: data.productId,
      priceId: price_id,
      quantity,
      creationSource: "TEST_MODE",
    });
    if (promoRedemption) {
      await markPromoCodeRedemptionApplied({
        prisma,
        tenancyId: tenancy.id,
        redemptionId: promoRedemption.redemptionId,
        subscriptionId: grantResult.type === "subscription" ? grantResult.subscriptionId : null,
        oneTimePurchaseId: grantResult.type === "one_time" ? grantResult.purchaseId : null,
      });
    }
    await purchaseUrlVerificationCodeHandler.revokeCode({
      tenancy,
      id: codeId,
    });

    return {
      statusCode: 200,
      bodyType: "success",
    };
  },
});
