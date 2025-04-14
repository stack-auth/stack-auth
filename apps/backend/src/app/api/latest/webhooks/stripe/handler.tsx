import { getSoleTenancyFromProject, getTenancyFromProject } from "@/lib/tenancies";
import { prismaClient } from "@/prisma-client";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import Stripe from "stripe";

type StripeConnectEventHandler<T extends Stripe.Event.Type> = (
  stripe: Stripe,
  event: Extract<Stripe.Event, { type: T }>,
  project: ProjectsCrud["Admin"]["Read"]
) => Promise<void>;

export const STRIPE_CONNECT_EVENT_HANDLERS: {
  [T in Stripe.Event.Type]?: StripeConnectEventHandler<T>
} = {
  "customer.subscription.created": async (stripe, event, project) => {
    const tenancy = await getSoleTenancyFromProject(project.id);
    const customer = await prismaClient.customer.findUnique({
      where: {
        stripeCustomerId: typeof event.data.object.customer === 'string' ? event.data.object.customer : event.data.object.customer.id,
      },
    });
    if (!customer) {
      throw new StackAssertionError('Customer not found; this should never happen');
    }
    await prismaClient.subscription.create({
      data: {
        tenancyId: tenancy.id,
        customerId: customer.customerId,
        stripeSubscriptionId: event.data.object.id,
        status: 'ACTIVE',
      },
    });
  },
};
