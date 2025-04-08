import { prismaClient } from "@/prisma-client";
import { createCrudHandlers } from "@/route-handlers/crud-handler";
import { getStripeClient } from "@/utils/stripe";
import { Price } from "@prisma/client";
import { internalPaymentsPricesCrud } from "@stackframe/stack-shared/dist/interface/crud/internal-payments-prices";
import { yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { createLazyProxy } from "@stackframe/stack-shared/dist/utils/proxies";

// Define the expected return type using the schema
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
  created_at_millis: string,
};

// Define params type
type PriceParams = {
  priceId?: string,
  productId?: string,
};

function prismaModelToCrud(prismaModel: Price): PriceReadType {
  return {
    id: prismaModel.id,
    product_id: prismaModel.productId,
    name: prismaModel.name,
    amount: prismaModel.amount,
    currency: prismaModel.currency,
    interval: prismaModel.interval,
    interval_count: prismaModel.intervalCount,
    stripe_price_id: prismaModel.stripePriceId,
    active: prismaModel.active,
    created_at_millis: prismaModel.createdAt.getTime().toString(),
  };
}

export const internalPaymentsPricesCrudHandlers = createLazyProxy(() => createCrudHandlers(internalPaymentsPricesCrud, {
  paramsSchema: yupObject({
    priceId: yupString().uuid(),
    productId: yupString().uuid(),
  }),
  onCreate: async ({ auth, data, params }) => {
    // First check if the product exists and belongs to the project
    const product = await prismaClient.product.findUnique({
      where: {
        id: data.product_id,
        projectId: auth.project.id,
      },
    });

    if (!product) {
      throwErr(`Product with ID ${data.product_id} not found or doesn't belong to this project`);
    }

    const price = await prismaClient.price.create({
      data: {
        name: data.name,
        amount: data.amount,
        currency: data.currency,
        interval: data.interval,
        intervalCount: data.interval_count,
        productId: data.product_id,
        active: data.active !== undefined ? data.active : true,
      },
    });

    // If project has Stripe config and product has stripeProductId, create a Stripe price
    if (auth.project.config.stripe_config && product.stripeProductId) {
      try {
        const stripe = getStripeClient(auth.project);
        const stripePrice = await stripe.prices.create({
          product: product.stripeProductId,
          unit_amount: data.amount,
          currency: data.currency,
          nickname: data.name,
          ...(data.interval ? {
            recurring: {
              interval: data.interval as 'day' | 'week' | 'month' | 'year',
              interval_count: data.interval_count || 1,
            }
          } : {}),
          metadata: {
            stack_price_id: price.id,
          },
          active: data.active !== undefined ? data.active : true,
        });

        // Update the price with the Stripe price ID
        await prismaClient.price.update({
          where: { id: price.id },
          data: { stripePriceId: stripePrice.id }
        });

        return prismaModelToCrud({
          ...price,
          stripePriceId: stripePrice.id
        });
      } catch (error) {
        console.error("Error creating Stripe price:", error);
        // Continue without Stripe price creation if it fails
      }
    }

    return prismaModelToCrud(price);
  },
  onRead: async ({ params, auth }) => {
    const price = await prismaClient.price.findFirst({
      where: {
        id: params.priceId,
        product: {
          projectId: auth.project.id,
        },
      },
    });

    if (!price) {
      throwErr(`Price with ID ${params.priceId} not found`);
    }

    return prismaModelToCrud(price);
  },
  onList: async ({ auth, params }) => {
    // If productId is provided, only list prices for that product
    const where = params.productId ? {
      product: {
        id: params.productId,
        projectId: auth.project.id,
      },
    } : {
      product: {
        projectId: auth.project.id,
      },
    };

    const prices = await prismaClient.price.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });

    return {
      items: prices.map(prismaModelToCrud),
      is_paginated: false,
    };
  },
  onUpdate: async ({ params, auth, data }) => {
    // First check if the price exists and belongs to the project
    const existingPrice = await prismaClient.price.findFirst({
      where: {
        id: params.priceId,
        product: {
          projectId: auth.project.id,
        }
      },
      include: {
        product: true,
      }
    });

    if (!existingPrice) {
      throwErr(`Price with ID ${params.priceId} not found or doesn't belong to this project`);
    }

    const updatedPrice = await prismaClient.price.update({
      where: {
        id: params.priceId,
      },
      data: {
        name: data.name,
        amount: data.amount,
        currency: data.currency,
        interval: data.interval,
        intervalCount: data.interval_count,
        active: data.active,
      },
    });

    // If the price has a Stripe price ID, update it in Stripe
    if (updatedPrice.stripePriceId && auth.project.config.stripe_config) {
      try {
        const stripe = getStripeClient(auth.project);
        
        // In Stripe, you can't update the amount, currency, or interval of an existing price
        // So instead, we have to create a new price and archive the old one
        // We only update metadata and active status
        await stripe.prices.update(
          updatedPrice.stripePriceId,
          {
            active: data.active,
            metadata: {
              stack_price_id: updatedPrice.id,
            },
            nickname: data.name,
          }
        );
      } catch (error) {
        console.error("Error updating Stripe price:", error);
        // Continue without Stripe price update if it fails
      }
    }

    return prismaModelToCrud(updatedPrice);
  },
  onDelete: async ({ params, auth }) => {
    // First check if the price exists and belongs to the project
    const price = await prismaClient.price.findFirst({
      where: {
        id: params.priceId,
        product: {
          projectId: auth.project.id,
        }
      },
    });

    if (!price) {
      throwErr(`Price with ID ${params.priceId} not found or doesn't belong to this project`);
    }

    // If the price has a Stripe price ID, archive it in Stripe
    if (price.stripePriceId && auth.project.config.stripe_config) {
      try {
        const stripe = getStripeClient(auth.project);
        await stripe.prices.update(price.stripePriceId, { active: false });
      } catch (error) {
        console.error("Error archiving Stripe price:", error);
        // Continue with deletion even if Stripe update fails
      }
    }

    await prismaClient.price.delete({
      where: {
        id: params.priceId,
      },
    });
  },
}));