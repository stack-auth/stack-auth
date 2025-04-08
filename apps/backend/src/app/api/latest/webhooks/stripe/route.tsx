import { retryTransaction } from "@/prisma-client";
import { getStripeClient } from "@/utils/stripe";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { NextApiRequest } from "next";
import { headers } from "next/headers";
import { Readable } from "node:stream";
import Stripe from "stripe";

// $ stripe listen --forward-to http://localhost:8102/api/v1/webhooks/stripe
// $ stripe trigger account.updated
async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const stripe = getStripeClient();
const STACK_STRIPE_WEBHOOK_SECRET = getEnvVariable("STACK_STRIPE_WEBHOOK_SECRET");

type StripeConnectEventHandler<T extends Stripe.Event.Type> = (
  stripe: Stripe,
  event: Extract<Stripe.Event, { type: T }>,
) => Promise<void>;

const STRIPE_CONNECT_EVENT_HANDLERS: {
  [T in Stripe.Event.Type]?: StripeConnectEventHandler<T>
} = {
  "account.updated": async (stripe, event) => {
    const account = event.data.object;

    if (!account.metadata?.stack_project_id) return;
    if (!account.details_submitted) return;
    const projectId = account.metadata.stack_project_id;

    await retryTransaction(async (tx) => {
      const projectConfig = await tx.projectConfig.findFirst({
        where: { projects: { some: { id: projectId } } },
        include: { stripeConfig: true }
      });

      if (projectConfig?.stripeConfig) {
        await tx.stripeConfig.update({
          where: { id: projectConfig.stripeConfig.id },
          data: { stripeAccountId: account.id }
        });
      } else if (projectConfig) {
        await tx.stripeConfig.create({
          data: {
            projectConfigId: projectConfig.id,
            stripeAccountId: account.id
          }
        });
      }
    });
  },
  "product.created": async (stripe, event) => {
    const stripeProduct = event.data.object;
    if (!stripeProduct.metadata.stack_product_id) return;
    const stackProductId = stripeProduct.metadata.stack_product_id;

    await retryTransaction(async (tx) => {
      const stackProduct = await tx.product.findUnique({
        where: { id: stackProductId }
      });

      if (stackProduct) {
        // Update the product with the Stripe product ID
        await tx.product.update({
          where: { id: stackProduct.id },
          data: { stripeProductId: stripeProduct.id }
        });
      }
    });
  },
  "price.created": async (stripe, event) => {
    const stripePrice = event.data.object;
    
    await retryTransaction(async (tx) => {
      // If this price has metadata with stack_price_id, link it to our price
      if (stripePrice.metadata?.stack_price_id) {
        const stackPriceId = stripePrice.metadata.stack_price_id;
        const existingPrice = await tx.price.findUnique({
          where: { id: stackPriceId }
        });
        
        if (existingPrice) {
          await tx.price.update({
            where: { id: stackPriceId },
            data: { stripePriceId: stripePrice.id }
          });
        }
      } else if (stripePrice.product) {
        // If there's no stack_price_id but we have a product, try to create a matching price
        const productId = typeof stripePrice.product === 'string'
          ? stripePrice.product 
          : stripePrice.product.id;
        
        // Find our product with this Stripe product ID
        const stackProduct = await tx.product.findUnique({
          where: { stripeProductId: productId }
        });
        
        if (stackProduct) {
          // Create a matching price in our system
          await tx.price.create({
            data: {
              name: stripePrice.nickname || `Price ${stripePrice.id}`,
              amount: stripePrice.unit_amount || 0,
              currency: stripePrice.currency,
              interval: stripePrice.recurring?.interval || null,
              intervalCount: stripePrice.recurring?.interval_count || null,
              stripePriceId: stripePrice.id,
              active: stripePrice.active,
              productId: stackProduct.id
            }
          });
        }
      }
    });
  },
  "price.updated": async (stripe, event) => {
    const stripePrice = event.data.object;
    
    await retryTransaction(async (tx) => {
      // Update the price in our system if it exists
      if (stripePrice.id) {
        const stackPrice = await tx.price.findUnique({
          where: { stripePriceId: stripePrice.id }
        });
        
        if (stackPrice) {
          await tx.price.update({
            where: { id: stackPrice.id },
            data: {
              name: stripePrice.nickname || stackPrice.name,
              active: stripePrice.active
            }
          });
        }
      }
    });
  }
};

export const POST = async (req: NextApiRequest) => {
  try {
    // For Stripe Connect webhooks, we use the platform's secret key
    const head = await headers();
    const body = await buffer(req.body as Readable);

    const signature = head.get('stripe-signature');
    if (!signature) {
      return Response.json({ error: 'No signature' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      // Use the platform webhook secret for Stripe Connect events
      event = stripe.webhooks.constructEvent(body, signature, STACK_STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      return Response.json({ error: `Webhook error: ${error}` }, { status: 400 });
    }

    // Handle the event
    await STRIPE_CONNECT_EVENT_HANDLERS[event.type]?.(stripe, event as any);

    return Response.json({ received: true });
  } catch (error) {
    console.error('Error processing Stripe Connect webhook:', error);
    return Response.json({ error: 'Webhook error' }, { status: 400 });
  }
};

export const config = {
  api: {
    bodyParser: false,
  },
};
