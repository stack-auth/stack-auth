import { GLOBAL_STRIPE } from "@/lib/stripe";
import { prismaClient } from "@/prisma-client";
import { createPrismaCrudHandlers } from "@/route-handlers/prisma-handler";
import { SubscriptionStatus } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared";
import { subscriptionsCrud } from "@stackframe/stack-shared/dist/interface/crud/subscriptions";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

export const subscriptionCrudHandlers = createLazyProxy(() => createPrismaCrudHandlers(subscriptionsCrud, "subscription", {
  paramsSchema: yupObject({
    subscription_id: yupString().uuid().defined(),
  }),
  querySchema: yupObject({}),
  baseFields: async ({ auth }) => ({
    tenancyId: auth.tenancy.id,
  }),
  whereUnique: async ({ params }) => ({
    id: params.subscription_id,
  }),
  where: async ({ auth }) => {
    // If you want to filter to current user's subscriptions only
    const customer = await prismaClient.customer.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        projectUserId: auth.user?.id,
      },
    });
    throw new KnownErrors.NotFound("Subscription not found");
  },
  include: async () => ({
    price: {
      include: {
        product: true,
      },
    },
    customer: true,
  }),
  orderBy: async () => ({
    createdAt: "desc",
  }),
  notFoundToCrud: () => {
    throw new KnownErrors.NotFound("Subscription not found");
  },
  crudToPrisma: async (crud, { auth, type, params }) => {
    if (type === "update") {
      const updates: Record<string, unknown> = {};

      const currentSubscription = await prismaClient.subscription.findUnique({
        where: { id: params.subscription_id },
      });

      if (!currentSubscription) {
        throw new KnownErrors.NotFound("Subscription not found for update");
      }

      // Set the appropriate fields based on status change
      if (crud.status === "CANCELLED" && currentSubscription.status !== "CANCELLED") {
        updates.status = SubscriptionStatus.CANCELLED;
        updates.cancelledAt = new Date();

        // Call Stripe API to cancel the subscription if it exists
        if (currentSubscription.stripeSubscriptionId) {
          try {
            await GLOBAL_STRIPE.subscriptions.cancel(currentSubscription.stripeSubscriptionId);
          } catch (error) {
            console.error("Error cancelling Stripe subscription:", error);
            // Continue with the update even if Stripe API fails
          }
        }
      } else {
        updates.status = crud.status as SubscriptionStatus;
      }

      return updates;
    }

    throw new StackAssertionError("Only update operations are supported for subscriptions");
  },
  prismaToCrud: async (prisma) => {
    return {
      id: prisma.id,
      status: prisma.status,
      customer_id: prisma.customerId,
      stripe_subscription_id: prisma.stripeSubscriptionId,
      stripe_subscription_item_id: prisma.stripeSubscriptionItemId,
      price_id: prisma.priceId,
      created_at_millis: prisma.createdAt.getTime(),
      updated_at_millis: prisma.updatedAt.getTime(),
      cancelled_at_millis: prisma.cancelledAt?.getTime() ?? null,
    };
  },
}));
