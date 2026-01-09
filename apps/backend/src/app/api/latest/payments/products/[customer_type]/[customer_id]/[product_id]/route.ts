import { ensureProductIdOrInlineProduct, getOwnedProductsForCustomer } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { KnownErrors } from "@stackframe/stack-shared";
import { StackAssertionError, StatusError, captureError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { SubscriptionStatus } from "@/generated/prisma/client";
import { getStripeForAccount } from "@/lib/stripe";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";

export const DELETE = createSmartRouteHandler({
  metadata: {
    summary: "Cancel a customer's subscription product",
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_type: yupString().oneOf(["user", "team", "custom"]).defined(),
      customer_id: yupString().defined(),
      product_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }, fullReq) => {
    if (auth.type === "client") {
      const currentUser = fullReq.auth?.user;
      if (!currentUser) {
        throw new KnownErrors.UserAuthenticationRequired();
      }
      if (params.customer_type === "user") {
        if (params.customer_id !== currentUser.id) {
          throw new StatusError(StatusError.Forbidden, "Clients can only cancel their own subscriptions.");
        }
      } else if (params.customer_type === "team") {
        const prisma = await getPrismaClientForTenancy(auth.tenancy);
        await ensureUserTeamPermissionExists(prisma, {
          tenancy: auth.tenancy,
          teamId: params.customer_id,
          userId: currentUser.id,
          permissionId: "team_admin",
          errorType: "required",
          recursive: true,
        });
      } else {
        throw new StatusError(StatusError.Forbidden, "Clients can only cancel user or team subscriptions they control.");
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const product = await ensureProductIdOrInlineProduct(auth.tenancy, auth.type, params.product_id, undefined);
    if (params.customer_type !== product.customerType) {
      throw new KnownErrors.ProductCustomerTypeDoesNotMatch(
        params.product_id,
        params.customer_id,
        product.customerType,
        params.customer_type,
      );
    }

    const ownedProducts = await getOwnedProductsForCustomer({
      prisma,
      tenancy: auth.tenancy,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    const ownedProductsForProduct = ownedProducts.filter((p) => p.id === params.product_id);
    if (ownedProductsForProduct.length === 0) {
      throw new StatusError(400, "Customer does not have this product.");
    }
    if (ownedProductsForProduct.some((product) => product.type === "one_time")) {
      throw new StatusError(400, "This product is a one time purchase and cannot be canceled.");
    }

    const subscriptions = await prisma.subscription.findMany({
      where: {
        tenancyId: auth.tenancy.id,
        customerType: typedToUppercase(params.customer_type),
        customerId: params.customer_id,
        productId: params.product_id,
        status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] },
      },
    });
    if (subscriptions.length === 0) {
      captureError("cancel-subscription-missing", new StackAssertionError(
        "Owned subscription product missing active/trialing subscription record.",
        {
          customerType: params.customer_type,
          customerId: params.customer_id,
          productId: params.product_id,
        },
      ));
      throw new StatusError(400, "This subscription cannot be canceled.");
    }

    const hasStripeSubscription = subscriptions.some((subscription) => subscription.stripeSubscriptionId);
    const stripe = hasStripeSubscription ? await getStripeForAccount({ tenancy: auth.tenancy }) : undefined;
    for (const subscription of subscriptions) {
      if (subscription.stripeSubscriptionId) {
        const stripeClient = stripe ?? throwErr(500, "Stripe client missing for subscription cancellation.");
        await stripeClient.subscriptions.cancel(subscription.stripeSubscriptionId);
        continue;
      }
      await prisma.subscription.update({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: subscription.id,
          },
        },
        data: {
          status: SubscriptionStatus.canceled,
          currentPeriodEnd: new Date(),
          cancelAtPeriodEnd: true,
        },
      });
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
