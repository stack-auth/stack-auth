import { ensureClientCanAccessCustomer, ensureCustomerExists, ensureProductIdOrInlineProduct, grantProductToCustomer, isActiveSubscription, productToInlineProduct } from "@/lib/payments";
import { getOwnedProductsForCustomer, getSubscriptionMapForCustomer } from "@/lib/payments/customer-data";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { customerProductsListResponseSchema } from "@stackframe/stack-shared/dist/interface/crud/products";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineProductSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries, typedFromEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";
import { stringCompare } from "@stackframe/stack-shared/dist/utils/strings";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "List products owned by a customer",
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
    }).defined(),
    query: yupObject({
      cursor: yupString().optional(),
      limit: yupString().optional(),
    }).default(() => ({})).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: customerProductsListResponseSchema,
  }),
  handler: async ({ auth, params, query }, fullReq) => {
    if (auth.type === "client") {
      await ensureClientCanAccessCustomer({
        customerType: params.customer_type,
        customerId: params.customer_id,
        user: fullReq.auth?.user,
        tenancy: auth.tenancy,
        forbiddenMessage: "Clients can only access their own user or team products.",
      });
    }
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    await ensureCustomerExists({
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    const [ownedProducts, subMap] = await Promise.all([
      getOwnedProductsForCustomer({
        prisma,
        tenancyId: auth.tenancy.id,
        customerType: params.customer_type,
        customerId: params.customer_id,
      }),
      getSubscriptionMapForCustomer({
        prisma,
        tenancyId: auth.tenancy.id,
        customerType: params.customer_type,
        customerId: params.customer_id,
      }),
    ]);
    // Deprecated: map productId → active subscription for backward-compat fields.
    // ownedProducts keys use '__null__' for inline products (null productId),
    // so we normalize subscription productIds to match.
    const activeSubByProductId = new Map(
      Object.values(subMap).filter(s => isActiveSubscription(s)).map(s => [s.productId ?? "__null__", s] as const)
    );

    // Build switch options per product line (available plan upgrades/downgrades)
    const switchOptionsByProductLineId = new Map<string, Array<{ product_id: string, product: ReturnType<typeof productToInlineProduct> }>>();
    const configuredProducts = auth.tenancy.config.payments.products;
    for (const [productId, product] of typedEntries(configuredProducts)) {
      if (product.customerType !== params.customer_type) continue;
      if (auth.type === "client" && product.serverOnly) continue;
      if (!product.productLineId) continue;
      const hasIntervalPrice = typedEntries(product.prices).some(([, price]) => price.interval);
      if (!hasIntervalPrice) continue;
      if (product.isAddOnTo && typedKeys(product.isAddOnTo).length > 0) continue;

      const inlineProduct = productToInlineProduct(product);
      const intervalPrices = typedFromEntries(
        typedEntries(inlineProduct.prices).filter(([, price]) => price.interval),
      );
      if (typedEntries(intervalPrices).length === 0) continue;

      const existing = switchOptionsByProductLineId.get(product.productLineId) ?? [];
      existing.push({ product_id: productId, product: { ...inlineProduct, prices: intervalPrices } });
      switchOptionsByProductLineId.set(product.productLineId, existing);
    }

    const entries = Object.entries(ownedProducts)
      .filter(([, p]) => p.quantity > 0)
      .filter(([, p]) => auth.type !== "client" || !p.product.serverOnly)
      .sort(([a], [b]) => stringCompare(a, b))
      .map(([productId, p]) => {
        const productLineId = p.productLineId;
        const switchOptions = productLineId
          ? (switchOptionsByProductLineId.get(productLineId) ?? []).filter((option) => option.product_id !== productId)
          : undefined;
        // Deprecated fields for backward compat
        const sub = activeSubByProductId.get(productId);
        const type = sub ? "subscription" as const : "one_time" as const;

        return {
          cursor: productId,
          item: {
            //safety check - now onwards inline products have product id as "__null__", but API expects null
            id: productId === "__null__" ? null : productId,
            quantity: p.quantity,
            // ProductSnapshot uses null where the Yup productSchema uses undefined; the data is equivalent
            product: productToInlineProduct(p.product as Parameters<typeof productToInlineProduct>[0]),
            type,
            subscription: sub ? {
              subscription_id: sub.id,
              current_period_end: sub.currentPeriodEndMillis ? new Date(sub.currentPeriodEndMillis).toISOString() : null,
              cancel_at_period_end: sub.cancelAtPeriodEnd,
              is_cancelable: true,
            } : null,
            switch_options: switchOptions,
          },
        };
      });

    let startIndex = 0;
    if (query.cursor) {
      startIndex = entries.findIndex((entry) => entry.cursor === query.cursor);
      if (startIndex === -1) {
        throw new StatusError(400, "Invalid cursor");
      }
    }

    const limit = yupNumber().min(1).max(100).optional().default(10).validateSync(query.limit);
    const pageEntries = entries.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < entries.length ? entries[startIndex + limit].cursor : null;

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        items: pageEntries.map((entry) => entry.item),
        is_paginated: true,
        pagination: {
          next_cursor: nextCursor,
        },
      },
    };
  },
});


export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Grant a product to a customer",
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_type: yupString().oneOf(["user", "team", "custom"]).defined(),
      customer_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      product_id: yupString().optional(),
      product_inline: inlineProductSchema.optional(),
      quantity: yupNumber().integer().min(1).default(1),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
      subscription_id: yupString().optional(),
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const { tenancy } = auth;
    const prisma = await getPrismaClientForTenancy(tenancy);
    await ensureCustomerExists({
      prisma,
      tenancyId: tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    const product = await ensureProductIdOrInlineProduct(
      tenancy,
      auth.type,
      body.product_id,
      body.product_inline,
    );

    if (params.customer_type !== product.customerType) {
      throw new KnownErrors.ProductCustomerTypeDoesNotMatch(
        body.product_id,
        params.customer_id,
        product.customerType,
        params.customer_type,
      );
    }

    const result = await grantProductToCustomer({
      prisma,
      tenancy,
      customerType: params.customer_type,
      customerId: params.customer_id,
      product,
      productId: body.product_id,
      priceId: undefined,
      quantity: body.quantity,
      creationSource: "API_GRANT",
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
        ...(result.type === "subscription" ? { subscription_id: result.subscriptionId } : {}),
      },
    };
  },
});
