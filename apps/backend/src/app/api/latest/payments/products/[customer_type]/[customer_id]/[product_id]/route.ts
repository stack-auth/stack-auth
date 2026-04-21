import { SubscriptionStatus } from "@/generated/prisma/client";
import { customerOwnsProduct, ensureCustomerExists, ensureProductIdOrInlineProduct, isActiveSubscription } from "@/lib/payments";
import { bulldozerWriteSubscription } from "@/lib/payments/bulldozer-dual-write";
import { getOwnedProductsForCustomer, getSubscriptionMapForCustomer } from "@/lib/payments/customer-data";
import { ensureFreePlanForBillingTeam } from "@/lib/payments/ensure-free-plan";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";

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
    query: yupObject({
      subscription_id: yupString().optional(),
    }).default(() => ({})).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, query }, fullReq) => {
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
    await ensureCustomerExists({
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });

    // Fetch subscription map and owned products from Bulldozer
    const subMap = await getSubscriptionMapForCustomer({
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    const allSubs = Object.values(subMap);

    let subscriptions;
    if (query.subscription_id) {
      // Cancel by subscription DB ID (used for inline products that have no product_id)
      subscriptions = allSubs.filter(s =>
        s.id === query.subscription_id && isActiveSubscription(s)
      );
      if (subscriptions.length === 0) {
        throw new StatusError(400, "No active subscription found with this ID for the given customer.");
      }
    } else {
      const product = await ensureProductIdOrInlineProduct(auth.tenancy, auth.type, params.product_id, undefined);
      if (params.customer_type !== product.customerType) {
        throw new KnownErrors.ProductCustomerTypeDoesNotMatch(
          params.product_id,
          params.customer_id,
          product.customerType,
          params.customer_type,
        );
      }

      // Check ownership via Bulldozer owned products (covers both subs and OTPs)
      const ownedProducts = await getOwnedProductsForCustomer({
        prisma,
        tenancyId: auth.tenancy.id,
        customerType: params.customer_type,
        customerId: params.customer_id,
      });
      if (!customerOwnsProduct(ownedProducts, params.product_id)) {
        throw new StatusError(400, "Customer does not have this product.");
      }

      // Find the active subscription to cancel
      subscriptions = allSubs.filter(s =>
        s.productId === params.product_id && isActiveSubscription(s)
      );
      if (subscriptions.length === 0) {
        // Customer owns the product but via OTP, not subscription
        throw new StatusError(400, "This product is a one time purchase and cannot be canceled.");
      }
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
          cancelAtPeriodEnd: true,
          canceledAt: new Date(),
          endedAt: new Date(subscription.currentPeriodEndMillis),
        },
      });
      // dual write - prisma and bulldozer
      const updatedSub = await prisma.subscription.findUniqueOrThrow({
        where: { tenancyId_id: { tenancyId: auth.tenancy.id, id: subscription.id } },
      });
      await bulldozerWriteSubscription(prisma, updatedSub);
    }

    // Regrant the free plan if a Stack Auth billing team just lost their
    // only plans-line sub. Scoped to the internal tenancy — customer
    // projects' own sub cancellations are for their own products.
    if (auth.tenancy.project.id === "internal" && params.customer_type === "team") {
      await ensureFreePlanForBillingTeam(params.customer_id);
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
