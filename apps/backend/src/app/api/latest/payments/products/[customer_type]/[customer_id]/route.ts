import { ensureProductIdOrInlineProduct, getOwnedProductsForCustomer, grantProductToCustomer, productToInlineProduct } from "@/lib/payments";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineProductSchema, serverOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { KnownErrors } from "@stackframe/stack-shared";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { customerProductsListResponseSchema } from "@stackframe/stack-shared/dist/interface/crud/products";
import { SubscriptionStatus } from "@prisma/client";
import { getStripeForAccount } from "@/lib/stripe";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";

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
    }).defined(),
    body: yupObject({
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
  handler: async ({ auth, params, body }, fullReq) => {
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
    const product = await ensureProductIdOrInlineProduct(auth.tenancy, auth.type, body.product_id, undefined);
    if (params.customer_type !== product.customerType) {
      throw new KnownErrors.ProductCustomerTypeDoesNotMatch(
        body.product_id,
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
    const ownedProduct = ownedProducts.find((p) => p.id === body.product_id);
    if (!ownedProduct) {
      throw new StatusError(400, "Customer does not have this product.");
    }
    if (ownedProduct.type === "one_time") {
      throw new StatusError(400, "This product is a one time purchase and cannot be canceled.");
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        tenancyId: auth.tenancy.id,
        customerType: typedToUppercase(params.customer_type),
        customerId: params.customer_id,
        productId: body.product_id,
        status: { in: [SubscriptionStatus.active, SubscriptionStatus.trialing] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!subscription) {
      throw new StatusError(400, "This subscription cannot be canceled.");
    }

    if (subscription.stripeSubscriptionId) {
      const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
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

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
