import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { getStripeClient } from "@/utils/stripe";
import { Price, Product } from "@prisma/client";
import { internalPaymentsProductsCrud } from "@stackframe/stack-shared/dist/interface/crud/internal-payments-products";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

// Define the expected return type using the schema
type ProductReadType = {
  id: string,
  name: string,
  stripe_product_id: string | null,
  associated_permission_id: string | null,
  created_at_millis: string,
  project_id: string,
};

// Define the price read type
type PriceReadType = {
  id: string,
  product_id: string,
  name: string,
  amount: number,
  currency: string,
  interval: string | null,
  interval_count: number | null,
  stripe_price_id: string | null,
  active: boolean,
  is_default: boolean,
  created_at_millis: string,
};

// Define params type
type ProductParams = {
  productId?: string,
};

function prismaModelToCrud(prismaModel: Product): ProductReadType {
  return {
    id: prismaModel.id,
    name: prismaModel.name,
    stripe_product_id: prismaModel.stripeProductId,
    associated_permission_id: prismaModel.associatedPermissionId,
    created_at_millis: prismaModel.createdAt.getTime().toString(),
    project_id: prismaModel.projectId,
  };
}

function priceModelToCrud(price: Price): PriceReadType {
  return {
    id: price.id,
    product_id: price.productId,
    name: price.name,
    amount: price.amount,
    currency: price.currency,
    interval: price.interval,
    interval_count: price.intervalCount,
    stripe_price_id: price.stripePriceId,
    active: price.active,
    is_default: price.isDefault === 'TRUE',
    created_at_millis: price.createdAt.getTime().toString(),
  };
}

export const internalPaymentsProductsCrudHandlers = createLazyProxy(() => createCrudHandlers(internalPaymentsProductsCrud, {
  paramsSchema: yupObject({
    productId: yupString().uuid().defined(),
  }),
  onCreate: async ({ auth, data }) => {
    const product = await prismaClient.product.create({
      data: {
        name: data.name,
        associatedPermissionId: data.associated_permission_id,
        projectId: auth.project.id,
      },
    });

    // If project has Stripe config and no stripe_product_id was provided, create a Stripe product
    if (auth.project.config.stripe_config?.stripe_account_id) {
      const stripe = getStripeClient(auth.project);
      await stripe.products.create({
        name: data.name,
        metadata: {
          stack_product_id: product.id,
        }
      });
    }
    return prismaModelToCrud(product);
  },
  onRead: async ({ params, auth }) => {
    const product = await prismaClient.product.findUnique({
      where: {
        projectId: auth.project.id,
        id: params.productId,
      },
      include: {
        prices: true,
      },
    });

    if (!product) {
      throwErr(`Product with ID ${params.productId} not found`);
    }

    return {
      ...prismaModelToCrud(product),
      prices: product.prices.map(priceModelToCrud),
    };
  },
  onList: async ({ auth }) => {
    const products = await prismaClient.product.findMany({
      where: {
        projectId: auth.project.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        prices: true,
      },
    });

    return {
      items: products.map(product => ({
        ...prismaModelToCrud(product),
        prices: product.prices.map(priceModelToCrud),
      })),
      is_paginated: false,
    };
  },
  onUpdate: async ({ params, auth, data }) => {
    const updatedProduct = await prismaClient.product.update({
      where: {
        projectId: auth.project.id,
        id: params.productId,
      },
      data: {
        name: data.name,
        stripeProductId: data.stripe_product_id,
        associatedPermissionId: data.associated_permission_id,
      },
      include: {
        prices: true,
      },
    });

    return {
      ...prismaModelToCrud(updatedProduct),
      prices: updatedProduct.prices.map(priceModelToCrud),
    };
  },
  onDelete: async ({ params, auth }) => {
    await prismaClient.product.delete({
      where: {
        projectId: auth.project.id,
        id: params.productId,
      },
    });
  },
}));
