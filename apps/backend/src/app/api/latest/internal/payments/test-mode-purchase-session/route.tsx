import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { grantProductToCustomer } from "@/lib/payments";
import { getTenancy } from "@/lib/tenancies";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
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
  handler: async ({ body }) => {
    const { full_code, price_id, quantity } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);

    const tenancy = await getTenancy(data.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError("Tenancy not found for test mode purchase session");
    }
    if (tenancy.config.payments.testMode !== true) {
      throw new StatusError(403, "Test mode is not enabled for this project");
    }
    const prisma = await getPrismaClientForTenancy(tenancy);

    await grantProductToCustomer({
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
