
import { prismaClient as prisma } from "@/prisma-client";
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

// rewrite to use export const POST = ...
export const POST = async (req: NextApiRequest, { params }: { params: { project_id: string } }) => {
  try {
    const projectId = params.project_id;

    // Fetch the project with its config and stripe config
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        config: {
          include: {
            stripeConfig: true
          }
        }
      }
    });

    if (!project || !project.config.stripeConfig) {
      return Response.json({ error: 'Stripe configuration not found for this project' }, { status: 404 });
    }

    const { stripeSecretKey, stripeWebhookSecret } = project.config.stripeConfig;

    if (!stripeWebhookSecret) {
      return Response.json({ error: 'Stripe webhook secret not configured' }, { status: 400 });
    }

    const stripe = new Stripe(stripeSecretKey);

    const head = await headers();
    const body = await buffer(req.body as Readable);

    const signature = head.get('stripe-signature');
    if (!signature) {
      return Response.json({ error: 'No signature' }, { status: 400 });
    }

    let event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);

    // Handle the event
    console.log('Stripe event received:', event.type);

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
