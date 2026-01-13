import { ensureProductIdOrInlineProduct, getOwnedProductsForCustomer, grantProductToCustomer, productToInlineProduct } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineProductSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { KnownErrors } from "@stackframe/stack-shared";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { customerProductsListResponseSchema } from "@stackframe/stack-shared/dist/interface/crud/products";

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
  handler: async ({ auth, params, query }) => {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const ownedProducts = await getOwnedProductsForCustomer({
      prisma,
      tenancy: auth.tenancy,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });

    const visibleProducts =
      auth.type === "client"
        ? ownedProducts.filter(({ product }) => !product.serverOnly)
        : ownedProducts;

    const sorted = visibleProducts
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((product) => ({
        cursor: product.sourceId,
        item: {
          id: product.id,
          quantity: product.quantity,
          product: productToInlineProduct(product.product),
          type: product.type,
          subscription: product.subscription ? {
            current_period_end: product.subscription.currentPeriodEnd ? product.subscription.currentPeriodEnd.toISOString() : null,
            cancel_at_period_end: product.subscription.cancelAtPeriodEnd,
            is_cancelable: product.subscription.isCancelable,
          } : null,
        },
      }));

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

