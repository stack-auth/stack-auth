
import { grantProjectPermission, revokeProjectPermission } from "@/lib/permissions";
import { getProjectQuery } from "@/lib/projects";
import { getTenancyFromProject } from "@/lib/tenancies";
import { PrismaTransaction } from "@/lib/types";
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

async function findStackProductsFromSubscription(tx: PrismaTransaction, subscription: Stripe.Subscription) {
  const stripeProductIds = subscription.items.data
    .filter(item => item.plan.product)
    .map(item => item.plan.product)
    .filter((product): product is string | Stripe.Product => product !== null)
    .map(product => typeof product === "string" ? product : product.id);

  return await tx.product.findMany({
    where: {
      stripeProductId: {
        in: stripeProductIds,
      },
    },
    include: {
      associatedPermission: true,
    }
  });
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

    await retryTransaction(async (tx) => {
      const stackProducts = await findStackProductsFromSubscription(tx, event.data.object);
      const permissionsToAssign = stackProducts
        .map(x => x.associatedPermission)
        .filter(x => x !== null);

      for (const permission of permissionsToAssign) {
        if (permission) {
          await grantProjectPermission(tx, {
            tenancy,
            userId: user.id,
            permissionId: permission.queryableId,
          });
        }
      }
    });
  },
  "customer.subscription.deleted": async (stripe, event, project) => {
    const tenancy = await getTenancyFromProject(project.id, 'main', null);
    if (!tenancy) throw new KnownErrors.ProjectNotFound(project.id);

    const user = await rawQuery(getUserQuery(tenancy.project.id, tenancy.branchId, event.data.object.metadata.user_id));
    if (!user) throw new KnownErrors.UserNotFound();

    await retryTransaction(async (tx) => {
      const stackProducts = await findStackProductsFromSubscription(tx, event.data.object);

      const permissionsToAssign = stackProducts
        .map(x => x.associatedPermission)
        .filter(x => x !== null);

      for (const permission of permissionsToAssign) {
        if (permission) {
          await revokeProjectPermission(tx, {
            tenancy,
            userId: user.id,
            permissionId: permission.queryableId,
          });
        }
      }
    });
  },
  "account.updated": async (stripe, event, project) => {
    const account = event.data.object as Stripe.Account;

    // Check if this is the Stripe account created for this project (verify metadata)
    if (account.metadata?.stack_project_id === project.id) {
      // Check if the account is fully onboarded (details_submitted is true)
      if (account.details_submitted) {
        // Update the project's stripeAccountId
        await retryTransaction(async (tx) => {
          // Update the StripeConfig table to include the Stripe account ID
          const projectConfig = await tx.projectConfig.findFirst({
            where: { projects: { some: { id: project.id } } },
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
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    
    if (!project.config.stripe_config) {
      throw new KnownErrors.StripeConfigurationNotFound();
    }

    const stripeConfig = project.config.stripe_config;

    if (!stripeConfig.stripe_webhook_secret) {
      return Response.json({ error: 'Stripe webhook secret not configured' }, { status: 400 });
    }

    if (!stripeConfig.stripe_secret_key) {
      return Response.json({ error: 'Stripe secret key not configured' }, { status: 400 });
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
