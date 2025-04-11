import { getProject } from "@/lib/projects";
import { GLOBAL_STRIPE } from "@/lib/stripe";
import { prismaClient } from "@/prisma-client";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { NextApiRequest } from "next";
import { headers } from "next/headers";
import { Readable } from "node:stream";
import Stripe from "stripe";
import { STRIPE_CONNECT_EVENT_HANDLERS } from "./handler";

// $ stripe listen --forward-to http://localhost:8102/api/v1/webhooks/stripe
// $ stripe trigger account.updated
async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

const stripe = GLOBAL_STRIPE;
const STACK_STRIPE_WEBHOOK_SECRET = getEnvVariable("STACK_STRIPE_WEBHOOK_SECRET");

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
      event = stripe.webhooks.constructEvent(body, signature, STACK_STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      return Response.json({ error: `Webhook error: ${error}` }, { status: 400 });
    }

    const project = await getProjectFromEvent(event);
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 400 });
    }

    // Handle the event
    await STRIPE_CONNECT_EVENT_HANDLERS[event.type]?.(stripe, event as any, project);

    return Response.json({ received: true });
  } catch (error) {
    console.error('Error processing Stripe Connect webhook:', error);
    return Response.json({ error: 'Webhook error' }, { status: 400 });
  }
};


async function getProjectFromEvent(event: Stripe.Event) {
  if (event.account === undefined) {
    // return the internal project
    return await getProject("internal");
  }

  const paymentConfig = await prismaClient.paymentConfig.findFirst({
    where: {
      stripeAccountId: event.account,
    },
  });

  if (!paymentConfig) {
    throw new StackAssertionError("Payment config not found");
  }

  return await getProject(paymentConfig.projectConfigId);
}

export const config = {
  api: {
    bodyParser: false,
  },
};
