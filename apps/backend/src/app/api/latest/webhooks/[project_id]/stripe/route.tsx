
import { grantUserPermission, revokeUserPermission } from "@/lib/permissions";
import { getProjectQuery } from "@/lib/projects";
import { getTenancyFromProject, tenancyPrismaToCrud } from "@/lib/tenancies";
import { rawQuery, retryTransaction } from "@/prisma-client";
import { KnownErrors } from "@stackframe/stack-shared";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { NextApiRequest } from "next";
import { headers } from "next/headers";
import { Readable } from "node:stream";
import Stripe from "stripe";
import { getUserQuery } from "../../../users/crud";

// $ stripe listen --forward-to http://localhost:8102/api/v1/webhooks/stripe
// $ stripe trigger customer.subscription.created
async function buffer(readable: Readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

type StripeEventHandler<T extends Stripe.Event.Type> = (
  stripe: Stripe,
  event: Extract<Stripe.Event, { type: T }>,
  project: ProjectsCrud["Admin"]["Read"],
) => Promise<void>;

const STRIPE_EVENT_HANDLERS: {
  [T in Stripe.Event.Type]?: StripeEventHandler<T>
} = {
  "customer.subscription.created": async (stripe, event, project) => {
    const tenancy = await getTenancyFromProject(project.id, 'main', null);
    if (!tenancy) throw new KnownErrors.ProjectNotFound(project.id);

    const user = await rawQuery(getUserQuery(tenancy.project.id, tenancy.branchId, event.data.object.metadata.user_id));
    if (!user) throw new KnownErrors.UserNotFound();

    const productIds = event.data.object.items.data
      .filter(item => item.plan.product)
      .map(item => item.plan.product)
      .filter(product => product !== null)
      .map(product => typeof product === "string" ? product : product.id);

    await retryTransaction(async (tx) => {
      for (const productId of productIds) {
        const features = await stripe.products.listFeatures(productId);
        const permsToAssign = features.data
          .map(x => x.entitlement_feature.metadata['STACK_LINKED_PERMISSION'])
          .filter(x => typeof x === "string");

        for (const permId of permsToAssign) {
          const perm = await tx.permission.findUnique({
            where: {
              projectConfigId_queryableId: {
                projectConfigId: project.config.id,
                queryableId: permId,
              }
            },
          });
          if (perm) {
            await grantUserPermission(tx, {
              tenancy,
              userId: user.id,
              permissionId: perm.queryableId,
            });
          }
        }
      }
    });
  },
  "customer.subscription.deleted": async (stripe, event, project) => {
    const tenancy = await getTenancyFromProject(project.id, 'main', null);
    if (!tenancy) throw new KnownErrors.ProjectNotFound(project.id);

    const user = await rawQuery(getUserQuery(tenancy.project.id, tenancy.branchId, event.data.object.metadata.user_id));
    if (!user) throw new KnownErrors.UserNotFound();

    const productIds = event.data.object.items.data
      .filter(item => item.plan.product)
      .map(item => item.plan.product)
      .filter(product => product !== null)
      .map(product => typeof product === "string" ? product : product.id);

    await retryTransaction(async (tx) => {
      for (const productId of productIds) {
        const features = await stripe.products.listFeatures(productId);
        const permsToRevoke = features.data
          .map(x => x.entitlement_feature.metadata['STACK_LINKED_PERMISSION'])
          .filter(x => typeof x === "string");

        for (const permId of permsToRevoke) {
          const perm = await tx.permission.findUnique({
            where: {
              projectConfigId_queryableId: {
                projectConfigId: project.config.id,
                queryableId: permId,
              }
            },
          });
          if (perm) {
            await revokeUserPermission(tx, {
              tenancy,
              userId: user.id,
              permissionId: perm.queryableId,
            });
          }
        }
      }
    });
  },
};

// rewrite to use export const POST = ...
export const POST = async (req: NextApiRequest) => {
  // parse the URL manually to get the project_id from the path (second to last segment)
  const url = new URL((req as any).url);
  const project_id = url.pathname.split("/").slice(-2, -1)[0];
  if (!project_id) {
    return Response.json({ error: 'Project ID is required' }, { status: 400 });
  }

  try {
    const project = await rawQuery(getProjectQuery(project_id as string));
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
    await STRIPE_EVENT_HANDLERS[event.type]?.(stripe, event as any, project);

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
