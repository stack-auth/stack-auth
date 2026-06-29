import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { quotePromoCodeForPurchase } from "@/lib/payments/promo-codes";
import { validatePurchaseSession } from "@/lib/payments";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: false,
    summary: "Validate Promo Code",
    description: "Validates a promo code against a purchase code and returns a backend-computed discount quote.",
    tags: ["Payments"],
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined().meta({
        openapiField: {
          description: "The verification code from the purchase URL.",
          exampleValue: "proj_abc123_def456ghi789",
        },
      }),
      price_id: yupString().defined().meta({
        openapiField: {
          description: "The price ID to quote.",
          exampleValue: "monthly",
        },
      }),
      quantity: yupNumber().integer().min(1).default(1).meta({
        openapiField: {
          description: "The quantity to quote.",
          exampleValue: 1,
        },
      }),
      promo_code: yupString().defined().meta({
        openapiField: {
          description: "The promo code entered by the customer.",
          exampleValue: "PROMO-SUMMER",
        },
      }),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      valid: yupBoolean().defined(),
      error: yupString().optional(),
      promo_code_id: yupString().optional(),
      display_name: yupString().nullable().optional(),
      discount_type: yupString().oneOf(["percent", "amount_off_usd"]).optional(),
      percent_off_bps: yupNumber().integer().nullable().optional(),
      amount_off_usd_cents: yupNumber().integer().nullable().optional(),
      original_amount_usd_cents: yupNumber().integer().optional(),
      discount_amount_usd_cents: yupNumber().integer().optional(),
      final_amount_usd_cents: yupNumber().integer().optional(),
      subscription_duration: yupString().oneOf(["first_invoice", "forever"]).optional(),
    }).defined(),
  }),
  async handler({ body }) {
    try {
      const { data } = await purchaseUrlVerificationCodeHandler.validateCode(body.full_code);
      const tenancy = await getTenancy(data.tenancyId);
      if (!tenancy) {
        throw new HexclaveAssertionError("No tenancy found from purchase code data tenancy id. This should never happen.");
      }
      const prisma = await getPrismaClientForTenancy(tenancy);
      const { selectedPrice } = await validatePurchaseSession({
        prisma,
        tenancyId: tenancy.id,
        customerType: data.product.customerType,
        customerId: data.customerId,
        product: data.product,
        productId: data.productId,
        priceId: body.price_id,
        quantity: body.quantity,
      });
      if (!selectedPrice) {
        throw new StatusError(400, "Price not found on product associated with this purchase code");
      }
      const quote = await quotePromoCodeForPurchase({
        prisma,
        tenancyId: tenancy.id,
        customerType: data.product.customerType,
        customerId: data.customerId,
        product: data.product,
        productId: data.productId,
        priceId: body.price_id,
        selectedPrice,
        quantity: body.quantity,
        promoCode: body.promo_code,
      });
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          valid: true,
          promo_code_id: quote.promoCodeId,
          display_name: quote.displayName,
          discount_type: quote.discountType,
          percent_off_bps: quote.percentOffBps,
          amount_off_usd_cents: quote.amountOffUsdCents,
          original_amount_usd_cents: quote.originalAmountUsdCents,
          discount_amount_usd_cents: quote.discountAmountUsdCents,
          final_amount_usd_cents: quote.finalAmountUsdCents,
          subscription_duration: quote.subscriptionDuration,
        },
      };
    } catch (error) {
      if (error instanceof StatusError) {
        return {
          statusCode: 200,
          bodyType: "json",
          body: {
            valid: false,
            error: error.message,
          },
        };
      }
      throw error;
    }
  },
});
