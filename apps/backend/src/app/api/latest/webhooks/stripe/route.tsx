import { retryTransaction } from "@/prisma-client";
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

const STACK_STRIPE_SECRET_KEY = getEnvVariable("STACK_STRIPE_SECRET_KEY");
const STACK_STRIPE_WEBHOOK_SECRET = getEnvVariable("STACK_STRIPE_WEBHOOK_SECRET");

type StripeConnectEventHandler<T extends Stripe.Event.Type> = (
  stripe: Stripe,
  event: Extract<Stripe.Event, { type: T }>,
) => Promise<void>;

const STRIPE_CONNECT_EVENT_HANDLERS: {
  [T in Stripe.Event.Type]?: StripeConnectEventHandler<T>
} = {
  "account.updated": async (stripe, event) => {
    const account = event.data.object as Stripe.Account;

    // Check if this account has Stack metadata
    if (account.metadata?.stack_project_id) {
      const projectId = account.metadata.stack_project_id;

      // Check if the account is fully onboarded (details_submitted is true)
      if (account.details_submitted) {
        // Update the project's stripeAccountId
        await retryTransaction(async (tx) => {
          // Update the StripeConfig table to include the Stripe account ID
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
            // Create a new stripeConfig if it doesn't exist
            await tx.stripeConfig.create({
              data: {
                projectConfigId: projectConfig.id,
                stripeAccountId: account.id
              }
            });
          }
        });
      }
    }
  },
};

export const POST = async (req: NextApiRequest) => {
  try {
    // For Stripe Connect webhooks, we use the platform's secret key
    const stripe = new Stripe(STACK_STRIPE_SECRET_KEY);

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
