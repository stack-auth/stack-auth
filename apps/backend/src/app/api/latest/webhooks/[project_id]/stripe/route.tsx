
import { NextApiRequest, NextApiResponse } from "next";
import { headers } from "next/headers";
import { Readable } from "node:stream";
import Stripe from "stripe";


// $ stripe listen --forward-to http://localhost:8102/api/v1/webhooks/stripe
// $ stripe trigger payment_intent.succeeded


const ENDPOINT_SECRET = 'whsec_67f49d904ce250c87d4f62a13f31815742ce9a124316bcaee3d1d7d3a52473a0';

const stripe = new Stripe('key_here');

async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// rewrite to use export const POST = ...
export const POST = async (req: NextApiRequest, res: NextApiResponse) => {
  console.log('REQQQQ');

  const head = await headers();
  const body = await buffer(req.body as Readable);

  if (!head.get('stripe-signature')) {
    return res.status(400).send('No signature');
  }
  let event = stripe.webhooks.constructEvent(body, head.get('stripe-signature') as string, ENDPOINT_SECRET);
  // Handle the event
  console.log(event);
  res.status(200).json({ received: true });
};

export const config = {
  api: {
    bodyParser: false,
  },
};
