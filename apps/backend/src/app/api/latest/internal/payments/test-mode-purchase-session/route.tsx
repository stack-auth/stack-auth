import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, adminAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { purchaseUrlVerificationCodeHandler } from "@/app/api/latest/payments/purchases/verification-code-handler";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { addInterval } from "@stackframe/stack-shared/dist/utils/dates";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

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
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["success"]).defined(),
  }),
  handler: async ({ auth, body }) => {
    const { full_code, price_id } = body;
    const { data, id: codeId } = await purchaseUrlVerificationCodeHandler.validateCode(full_code);
    if (auth.tenancy.id !== data.tenancyId) {
      throw new StatusError(400, "Tenancy id does not match value from code data");
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const pricesMap = new Map(Object.entries(data.offer.prices));
    const selectedPrice = pricesMap.get(price_id);
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found on offer associated with this purchase code");
    }
    if (!selectedPrice.interval) {
      throw new StackAssertionError("unimplemented; prices without an interval are currently not supported");
    }
    await prisma.subscription.create({
      data: {
        tenancyId: auth.tenancy.id,
        customerId: data.customerId,
        customerType: typedToUppercase(data.offer.customerType),
        status: "active",
        offer: data.offer,
        currentPeriodStart: new Date(),
        currentPeriodEnd: addInterval(new Date(), selectedPrice.interval),
        cancelAtPeriodEnd: false,
        creationSource: "TEST_MODE",
      },
    });
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
