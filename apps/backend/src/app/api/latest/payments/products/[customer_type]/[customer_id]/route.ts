import { getOwnedProductsForCustomer } from "@/lib/payments";
import { ensureClientCanAccessCustomer, ensureProductIdOrInlineProduct, grantProductToCustomer, productToInlineProduct } from "@/lib/payments/index";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { customerProductsListResponseSchema } from "@stackframe/stack-shared/dist/interface/crud/products";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineProductSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedEntries, typedFromEntries, typedKeys } from "@stackframe/stack-shared/dist/utils/objects";

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
    const ownedProducts = await getOwnedProductsForCustomer({
      prisma,
      tenancy: auth.tenancy,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });

    const visibleProducts =
      auth.type === "client"
        ? ownedProducts.filter(({ type, product }) => type !== "include-by-default" && !product.server_only)
        : ownedProducts.filter(({ type }) => type !== "include-by-default");

    const switchOptionsByProductLineId = new Map<string, Array<{ product_id: string, product: ReturnType<typeof productToInlineProduct> }>>();

    const configuredProducts = auth.tenancy.config.payments.products;
    for (const [productId, product] of typedEntries(configuredProducts)) {
      if (product.customerType !== params.customer_type) continue;
      if (auth.type === "client" && product.serverOnly) continue;
      if (!product.productLineId) continue;
      if (product.prices === "include-by-default") continue;
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

    const sorted = visibleProducts
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .flatMap((product) => {
        if (product.type === "include-by-default") {
          return [];
        }
        const productLineId = product.product.product_line_id;
        const switchOptions =
          product.type === "subscription" && product.id && productLineId
            ? (switchOptionsByProductLineId.get(productLineId) ?? []).filter((option) => option.product_id !== product.id)
            : undefined;

        return [{
          cursor: product.sourceId,
          item: {
            id: product.id,
            quantity: product.quantity,
            product: product.product,
            type: product.type,
            subscription: product.subscription ? {
              current_period_end: product.subscription.currentPeriodEnd ? product.subscription.currentPeriodEnd.toISOString() : null,
              cancel_at_period_end: product.subscription.cancelAtPeriodEnd,
              is_cancelable: product.subscription.isCancelable,
            } : null,
            switch_options: switchOptions,
          },
        }];
      });

    let startIndex = 0;
    if (query.cursor) {
      startIndex = sorted.findIndex((entry) => entry.cursor === query.cursor);
      if (startIndex === -1) {
        throw new StatusError(400, "Invalid cursor");
      }
    }

    const limit = yupNumber().min(1).max(100).optional().default(10).validateSync(query.limit);
    const pageEntries = sorted.slice(startIndex, startIndex + limit);
    const nextCursor = startIndex + limit < sorted.length ? sorted[startIndex + limit].cursor : null;

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
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const { tenancy } = auth;
    const prisma = await getPrismaClientForTenancy(tenancy);
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

    await grantProductToCustomer({
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
      },
    };
  },
});
