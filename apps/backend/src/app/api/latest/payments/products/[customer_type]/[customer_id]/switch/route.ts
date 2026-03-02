import { SubscriptionStatus } from "@/generated/prisma/client";
import { ensureClientCanAccessCustomer, getDefaultCardPaymentMethodSummary, getStripeCustomerForCustomerOrNull } from "@/lib/payments/index";
import { getOwnedProductsForCustomer } from "@/lib/payments/ledger";
import { upsertProductVersion } from "@/lib/product-versions";
import { getStripeForAccount, sanitizeStripePeriodDates } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { getOrUndefined, typedEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import Stripe from "stripe";


export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Switch a customer's subscription product",
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_type: yupString().oneOf(["user", "team"]).defined(),
      customer_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      from_product_id: yupString().defined(),
      to_product_id: yupString().defined(),
      price_id: yupString().optional(),
      quantity: yupNumber().integer().min(1).optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, body }, fullReq) => {
    if (auth.tenancy.config.payments.blockNewPurchases) {
      throw new KnownErrors.NewPurchasesBlocked();
    }
    if (auth.type === "client") {
      await ensureClientCanAccessCustomer({
        customerType: params.customer_type,
        customerId: params.customer_id,
        user: fullReq.auth?.user,
        tenancy: auth.tenancy,
        forbiddenMessage: "Clients can only manage their own subscriptions.",
      });
    }

    const products = auth.tenancy.config.payments.products;
    const fromProduct = getOrUndefined(products, body.from_product_id);
    const toProduct = getOrUndefined(products, body.to_product_id);
    if (!fromProduct || !toProduct) {
      throw new StatusError(400, "Product not found.");
    }
    if (fromProduct.customerType !== params.customer_type || toProduct.customerType !== params.customer_type) {
      throw new StatusError(400, "Product customer type does not match.");
    }
    if (!fromProduct.productLineId || fromProduct.productLineId !== toProduct.productLineId) {
      throw new StatusError(400, "Products must be in the same product line to switch.");
    }
    if (body.from_product_id === body.to_product_id) {
      throw new StatusError(400, "Product is already active.");
    }
    if (toProduct.isAddOnTo && typedKeys(toProduct.isAddOnTo).length > 0) {
      throw new StatusError(400, "Add-on products cannot be selected for plan switching.");
    }
    const fromIsIncludeByDefault = fromProduct.prices === "include-by-default";
    if (toProduct.prices === "include-by-default") {
      throw new StatusError(400, "Include-by-default products cannot be selected for plan switching.");
    }
    if (!fromIsIncludeByDefault) {
      const fromHasIntervalPrice = typedEntries(fromProduct.prices as Exclude<typeof fromProduct.prices, "include-by-default">)
        .some(([, price]) => price.interval);
      if (!fromHasIntervalPrice) {
        throw new StatusError(400, "This subscription cannot be switched.");
      }
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const ownedProducts = await getOwnedProductsForCustomer({
      prisma,
      tenancy: auth.tenancy,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    const hasOneTimeInProductLine = ownedProducts.some((p) =>
      p.type === "one_time" && p.product.product_line_id === fromProduct.productLineId
    );
    if (hasOneTimeInProductLine) {
      throw new StatusError(400, "Customer already has a one-time purchase in this product line");
    }

    let subscription = null;
    if (!fromIsIncludeByDefault) {
      subscription = await prisma.subscription.findFirst({
        where: {
          tenancyId: auth.tenancy.id,
          customerType: typedToUppercase(params.customer_type),
          customerId: params.customer_id,
          productId: body.from_product_id,
          status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] },
        },
        orderBy: { createdAt: "desc" },
      });
    }
    if (!subscription && !fromIsIncludeByDefault) {
      throw new StatusError(400, "This subscription cannot be switched.");
    }
    if (subscription && !subscription.stripeSubscriptionId) {
      throw new StatusError(400, "This subscription cannot be switched.");
    }

    const priceEntries = typedEntries(toProduct.prices)
      .filter(([, price]) => price.interval);
    if (priceEntries.length === 0) {
      throw new StatusError(400, "Price not found for target product.");
    }
    const pricesMap = new Map(priceEntries);
    const selectedPriceId = body.price_id ?? priceEntries[0][0];
    const selectedPrice = pricesMap.get(selectedPriceId);
    if (!selectedPrice) {
      throw new StatusError(400, "Price not found for target product.");
    }
    if (!selectedPrice.interval) {
      throw new StatusError(400, "Price not found for target product.");
    }
    if (selectedPrice.USD === undefined) {
      throw new StatusError(400, "Target price must include a USD amount.");
    }
    const selectedInterval = selectedPrice.interval;
    const quantity = body.quantity ?? subscription?.quantity ?? 1;
    if (body.quantity !== undefined && quantity !== 1 && toProduct.stackable !== true) {
      throw new StatusError(400, "This product is not stackable; quantity must be 1");
    }

    const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
    const stripeCustomer = await getStripeCustomerForCustomerOrNull({
      stripe,
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    if (!stripeCustomer) {
      throw new KnownErrors.DefaultPaymentMethodRequired(params.customer_type, params.customer_id);
    }
    const hydratedStripeCustomer = await stripe.customers.retrieve(stripeCustomer.id);
    if (hydratedStripeCustomer.deleted) {
      throw new StatusError(400, "Stripe customer was deleted unexpectedly.");
    }
    const defaultPaymentMethod = await getDefaultCardPaymentMethodSummary({
      stripe,
      stripeCustomer: hydratedStripeCustomer,
    });
    if (!defaultPaymentMethod) {
      throw new KnownErrors.DefaultPaymentMethodRequired(params.customer_type, params.customer_id);
    }
    const resolvedPaymentMethodId = defaultPaymentMethod.id;

    const stripeProduct = await stripe.products.create({ name: toProduct.displayName || "Subscription" });

    const productVersionId = await upsertProductVersion({
      prisma,
      tenancyId: auth.tenancy.id,
      productId: body.to_product_id,
      productJson: toProduct,
    });

    if (subscription?.stripeSubscriptionId) {
      const existingStripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
      if (existingStripeSub.items.data.length === 0) {
        throw new StackAssertionError("Stripe subscription has no items", { subscriptionId: subscription.id });
      }
      const existingItem = existingStripeSub.items.data[0];
      const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        payment_behavior: "error_if_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        default_payment_method: resolvedPaymentMethodId,
        items: [{
          id: existingItem.id,
          price_data: {
            currency: "usd",
            unit_amount: Number(selectedPrice.USD) * 100,
            product: stripeProduct.id,
            recurring: {
              interval_count: selectedInterval[0],
              interval: selectedInterval[1],
            },
          },
          quantity,
        }],
        metadata: {
          productId: body.to_product_id,
          productVersionId,
          priceId: selectedPriceId,
        },
      });
      const updatedSubscription = updated as Stripe.Subscription;
      const sanitizedUpdateDates = sanitizeStripePeriodDates(existingItem.current_period_start, existingItem.current_period_end);

      await prisma.subscription.update({
        where: {
          tenancyId_id: {
            tenancyId: auth.tenancy.id,
            id: subscription.id,
          },
        },
        data: {
          productId: body.to_product_id,
          product: toProduct,
          priceId: selectedPriceId,
          quantity,
          status: updatedSubscription.status,
          currentPeriodStart: sanitizedUpdateDates.start,
          currentPeriodEnd: sanitizedUpdateDates.end,
          cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
        },
      });
    } else {
      const created = await stripe.subscriptions.create({
        customer: stripeCustomer.id,
        payment_behavior: "error_if_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        ...resolvedPaymentMethodId ? { default_payment_method: resolvedPaymentMethodId } : {},
        items: [{
          price_data: {
            currency: "usd",
            unit_amount: Number(selectedPrice.USD) * 100,
            product: stripeProduct.id,
            recurring: {
              interval_count: selectedInterval[0],
              interval: selectedInterval[1],
            },
          },
          quantity,
        }],
        metadata: {
          productId: body.to_product_id,
          productVersionId,
          priceId: selectedPriceId,
        },
      });
      const createdSubscription = created as Stripe.Subscription;
      if (createdSubscription.items.data.length === 0) {
        throw new StackAssertionError("Stripe subscription has no items", { stripeSubscriptionId: createdSubscription.id });
      }
      const createdItem = createdSubscription.items.data[0];
      const sanitizedCreateDates = sanitizeStripePeriodDates(createdItem.current_period_start, createdItem.current_period_end);

      await prisma.subscription.create({
        data: {
          tenancyId: auth.tenancy.id,
          customerId: params.customer_id,
          customerType: typedToUppercase(params.customer_type),
          productId: body.to_product_id,
          product: toProduct,
          priceId: selectedPriceId,
          quantity,
          stripeSubscriptionId: createdSubscription.id,
          status: createdSubscription.status,
          currentPeriodStart: sanitizedCreateDates.start,
          currentPeriodEnd: sanitizedCreateDates.end,
          cancelAtPeriodEnd: createdSubscription.cancel_at_period_end,
          creationSource: "PURCHASE_PAGE",
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
