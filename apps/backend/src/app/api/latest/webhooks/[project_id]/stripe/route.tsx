
import { getProjectQuery } from "@/lib/projects";
import { rawQuery } from "@/prisma-client";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { NextApiRequest } from "next";
import { headers } from "next/headers";
import { Readable } from "node:stream";
import Stripe from "stripe";

// $ stripe listen --forward-to http://localhost:8102/api/v1/webhooks/stripe
// $ stripe trigger payment_intent.succeeded
async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

type StripeEventHandler<T extends Stripe.Event.Type> = (
  event: Extract<Stripe.Event, { type: T }>,
  project: ProjectsCrud["Admin"]["Read"]
) => Promise<void>;

const STRIPE_EVENT_HANDLERS: {
  [T in Stripe.Event.Type]?: StripeEventHandler<T>
} = {
  "customer.subscription.created": async (event, project) => {
    console.log("Customer subscription created", event.data.object);
  },
  "customer.subscription.deleted": async (event, project) => {
    console.log("Customer subscription deleted", event.data.object);
  },
  "customer.subscription.updated": async (event, project) => {
    console.log("Customer subscription updated", event.data.object);
  },
};

// rewrite to use export const POST = ...
export const POST = async (req: NextApiRequest, { params }: { params: { project_id: string } }) => {
  try {
    const project = await rawQuery(getProjectQuery(params.project_id));
    if (!project || !project.config.stripe_config) {
      return Response.json({ error: 'Stripe configuration not found for this project' }, { status: 404 });
    }

    const stripeConfig = project.config.stripe_config;

    if (!stripeConfig.stripe_webhook_secret) {
      return Response.json({ error: 'Stripe webhook secret not configured' }, { status: 400 });
    }

    const stripe = new Stripe(stripeConfig.stripe_secret_key);

    const head = await headers();
    const body = await buffer(req.body as Readable);

    const signature = head.get('stripe-signature');
    if (!signature) {
      return Response.json({ error: 'No signature' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, stripeConfig.stripe_webhook_secret);
    } catch (error) {
      return Response.json({ error: `Webhook error: ${error}` }, { status: 400 });
    }

    // Handle the event
    await STRIPE_EVENT_HANDLERS[event.type]?.(event as any, project);

    return Response.json({ received: true });
  } catch (error) {
    console.error('Error processing Stripe webhook:', error);
    return Response.json({ error: 'Webhook error' }, { status: 400 });
  }
};

export const config = {
  api: {
    bodyParser: false,
  },
};
